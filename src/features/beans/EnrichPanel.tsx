/**
 * Web enrichment for an existing bean (specs/ui.md).
 *
 * Search the web for the product page, scrape it, and offer the extracted
 * fields as an opt-in diff. Nothing is written without an explicit choice, and
 * enrichment failing must never get in the way of manual editing.
 */
import { useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { db } from '@/services/db';
import { isSchemaError } from '@/services/ai';
import {
  EmptyPageError,
  enrichFromUrl,
  findCandidates,
  type EnrichCandidate,
  type EnrichedPage,
} from '@/services/enrich';
import {
  applyProposals,
  buildProposals,
  defaultSelection,
  type EnrichableField,
  type FieldProposal,
} from '@/services/enrich/diff';
import { attachPhotoFromUrl, beanNeedsPhoto } from '@/services/enrich/photo';
import type { CoffeeBean } from '@/types';

type Phase = 'idle' | 'searching' | 'candidates' | 'fetching' | 'review' | 'saving' | 'done';

export function EnrichPanel({ bean }: { bean: CoffeeBean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [candidates, setCandidates] = useState<EnrichCandidate[]>([]);
  const [page, setPage] = useState<EnrichedPage | null>(null);
  const [proposals, setProposals] = useState<FieldProposal[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<EnrichableField>>(new Set());
  const [usePhoto, setUsePhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only offered when the coffee has no picture of its own: enrichment fills
  // gaps, and silently swapping a photo the user took for a storefront render
  // would be a different and much less welcome thing to do.
  const photoOffered = page?.imageUrl !== undefined && beanNeedsPhoto(bean);
  const applyCount = selected.size + (usePhoto && photoOffered ? 1 : 0);

  function fail(err: unknown, fallback: string) {
    // Enrichment is additive: a failure returns the user to where they were
    // rather than blocking the page they came to use.
    if (err instanceof EmptyPageError) setError(err.message);
    else if (isSchemaError(err)) setError('We could not make sense of that page.');
    else setError(err instanceof Error ? err.message : fallback);
  }

  async function runSearch() {
    setError(null);
    setPhase('searching');
    try {
      const results = await findCandidates(bean.roaster, bean.name);
      setCandidates(results);
      setPhase('candidates');
    } catch (err) {
      fail(err, 'Could not search the web right now.');
      setPhase('idle');
    }
  }

  async function choose(url: string) {
    setError(null);
    setPhase('fetching');
    try {
      const enriched = await enrichFromUrl(url);
      const next = buildProposals(bean, enriched.parsed);
      setPage(enriched);
      setProposals(next);
      setSelected(defaultSelection(next));
      setUsePhoto(enriched.imageUrl !== undefined && beanNeedsPhoto(bean));
      setPhase('review');
    } catch (err) {
      fail(err, 'Could not read that page.');
      setPhase('candidates');
    }
  }

  function toggle(field: EnrichableField) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function applySelected() {
    if (!page) return;
    const update = applyProposals(page.parsed, selected, { sourceUrl: page.sourceUrl });

    // Fetched last, and never allowed to fail the whole apply: the fields the
    // user picked are the point, and a dead image URL should not cost them.
    let photoFailed = false;
    if (usePhoto && page.imageUrl && photoOffered) {
      setPhase('saving');
      const photo = await attachPhotoFromUrl(page.imageUrl);
      if (photo) Object.assign(update, photo);
      else photoFailed = true;
    }

    if (Object.keys(update).length === 0) {
      setPhase('done');
      return;
    }
    await db.beans.update(bean.id, update);
    setError(photoFailed ? 'We saved the details, but that photo could not be downloaded.' : null);
    setPhase('done');
  }

  function restart() {
    setPhase('idle');
    setCandidates([]);
    setPage(null);
    setProposals([]);
    setSelected(new Set());
    setUsePhoto(false);
    setError(null);
  }

  return (
    <section className="rounded border p-3">
      <h3 className="text-sm font-medium">Web enrichment</h3>

      {error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      )}

      {phase === 'idle' && (
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground text-sm">
            Search the web for this coffee and fill in any missing details. You choose what gets
            applied.
          </p>
          <Button variant="outline" size="sm" onClick={() => void runSearch()}>
            <Globe aria-hidden="true" /> Find details on the web
          </Button>
        </div>
      )}

      {(phase === 'searching' || phase === 'fetching' || phase === 'saving') && (
        <p role="status" className="text-muted-foreground mt-2 flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {phase === 'searching' && 'Searching…'}
          {phase === 'fetching' && 'Reading that page…'}
          {phase === 'saving' && 'Saving the photo…'}
        </p>
      )}

      {phase === 'candidates' && (
        <div className="mt-2 space-y-2">
          {candidates.length === 0 ? (
            <p className="text-muted-foreground text-sm">No results for this coffee.</p>
          ) : (
            <ul aria-label="Search results" className="space-y-2">
              {candidates.map((candidate) => (
                <li key={candidate.url} className="rounded border p-2">
                  <p className="text-sm font-medium">{candidate.title}</p>
                  <p className="text-muted-foreground text-xs">{candidate.snippet}</p>
                  <p className="text-muted-foreground mt-1 text-xs break-all">{candidate.url}</p>
                  <Button
                    className="mt-2"
                    variant="outline"
                    size="sm"
                    onClick={() => void choose(candidate.url)}
                  >
                    Use this page
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button variant="ghost" size="sm" onClick={restart}>
            Cancel
          </Button>
        </div>
      )}

      {phase === 'review' && page && (
        <div className="mt-2 space-y-3">
          {proposals.length === 0 && !photoOffered ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm">
                That page had nothing new to add — your details already match.
              </p>
              <Button variant="ghost" size="sm" onClick={restart}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">
                Choose what to apply. Changes that would replace an existing value start unchecked.
              </p>
              <ul aria-label="Proposed changes" className="space-y-2">
                {proposals.map((proposal) => (
                  <li key={proposal.field} className="rounded border p-2">
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1 size-4"
                        checked={selected.has(proposal.field)}
                        onChange={() => toggle(proposal.field)}
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{proposal.label}</span>
                        {proposal.current !== null && (
                          <span className="text-muted-foreground block text-xs line-through">
                            {proposal.current}
                          </span>
                        )}
                        <span className="block text-xs wrap-break-word">{proposal.proposed}</span>
                        {proposal.isConflict && (
                          <span className="text-destructive block text-xs">
                            Replaces your current value
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
                {photoOffered && page.imageUrl && (
                  <li className="rounded border p-2">
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1 size-4"
                        checked={usePhoto}
                        onChange={() => setUsePhoto((prev) => !prev)}
                      />
                      <span className="font-medium">Photo</span>
                      <img
                        src={page.imageUrl}
                        alt=""
                        className="size-20 rounded object-cover"
                        // A hotlinked preview can 404 or be blocked; hide the
                        // broken-image glyph rather than show a torn page.
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    </label>
                  </li>
                )}
              </ul>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={selected.size === 0 && !usePhoto}
                  onClick={() => void applySelected()}
                >
                  Apply {applyCount} {applyCount === 1 ? 'change' : 'changes'}
                </Button>
                <Button variant="ghost" size="sm" onClick={restart}>
                  Cancel
                </Button>
              </div>
              <p className="text-muted-foreground text-xs break-all">Source: {page.sourceUrl}</p>
            </>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className="mt-2 space-y-2">
          <p role="status" className="text-sm">
            Updated. Check the details above — enriched fields are flagged for review.
          </p>
          <Button variant="ghost" size="sm" onClick={restart}>
            Enrich again
          </Button>
        </div>
      )}
    </section>
  );
}
