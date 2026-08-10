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
import { enqueueUpsert } from '@/services/sync/outbox';
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
import {
  beanNeedsPhoto,
  commitStagedPhoto,
  comparePhotoResolution,
  getPhotoDimensions,
  preparePhotoFromUrl,
  releasePhotoIfOrphaned,
  type PhotoDimensions,
  type StagedPhoto,
} from '@/services/enrich/photo';
import type { CoffeeBean } from '@/types';

type Phase = 'idle' | 'searching' | 'candidates' | 'fetching' | 'review' | 'saving' | 'done';

/** How the found image compares to what the coffee already has. */
type PhotoOffer =
  | { kind: 'none' }
  /** The coffee has no photo, so this is a straight gap-fill. */
  | { kind: 'fill'; staged: StagedPhoto }
  /** The coffee has a photo, and the found one is sharper. */
  | { kind: 'upgrade'; staged: StagedPhoto; current: PhotoDimensions; ratio: number };

export function EnrichPanel({ bean }: { bean: CoffeeBean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [candidates, setCandidates] = useState<EnrichCandidate[]>([]);
  const [page, setPage] = useState<EnrichedPage | null>(null);
  const [proposals, setProposals] = useState<FieldProposal[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<EnrichableField>>(new Set());
  const [photoOffer, setPhotoOffer] = useState<PhotoOffer>({ kind: 'none' });
  const [usePhoto, setUsePhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoOffered = photoOffer.kind !== 'none';
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

  /**
   * Works out what to offer for the picture.
   *
   * The image is fetched and resized *before* asking, because the question
   * "is this one better?" cannot be answered from a URL — only from the same
   * normalised output that would actually be stored. A coffee with no photo
   * gets a straight offer; one that already has a photo is only interrupted
   * when the found image is genuinely sharper.
   */
  async function buildPhotoOffer(imageUrl: string | undefined): Promise<PhotoOffer> {
    if (!imageUrl) return { kind: 'none' };
    const staged = await preparePhotoFromUrl(imageUrl);
    if (!staged) return { kind: 'none' };

    if (beanNeedsPhoto(bean)) return { kind: 'fill', staged };

    const current = await getPhotoDimensions(bean.photoId);
    const { ratio, isUpgrade } = comparePhotoResolution(current, staged);
    // Same or lower resolution: staying quiet is the right answer. Offering a
    // sideways swap of the user's own photo for a storefront render is noise.
    if (!isUpgrade || !current) return { kind: 'none' };
    return { kind: 'upgrade', staged, current, ratio };
  }

  async function choose(url: string) {
    setError(null);
    setPhase('fetching');
    try {
      const enriched = await enrichFromUrl(url);
      const next = buildProposals(bean, enriched.parsed);
      const offer = await buildPhotoOffer(enriched.imageUrl);
      setPage(enriched);
      setProposals(next);
      setSelected(defaultSelection(next));
      setPhotoOffer(offer);
      // A sharper picture is pre-selected the same way a gap-fill is: it is the
      // better image on the only measure that is not a matter of taste, and the
      // side-by-side preview makes overriding it a single click.
      setUsePhoto(offer.kind !== 'none');
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

    // Stored last, and never allowed to fail the whole apply: the fields the
    // user picked are the point, and a photo that will not save should not
    // cost them those.
    let photoFailed = false;
    const replacing = photoOffer.kind === 'upgrade' ? bean.photoId : undefined;
    if (usePhoto && photoOffer.kind !== 'none') {
      setPhase('saving');
      try {
        Object.assign(update, await commitStagedPhoto(photoOffer.staged));
      } catch (err) {
        console.warn('Could not store enrichment photo', err);
        photoFailed = true;
      }
    }

    if (Object.keys(update).length === 0) {
      setPhase('done');
      return;
    }
    await db.beans.update(bean.id, update);
    await enqueueUpsert('bean', bean.id);

    // Only after the bean points at the new photo, so the outgoing one looks
    // like the orphan it now is. Skipped if the photo failed, since nothing
    // was replaced.
    if (replacing && !photoFailed) await releasePhotoIfOrphaned(replacing);

    setError(photoFailed ? 'We saved the details, but that photo could not be saved.' : null);
    setPhase('done');
  }

  function restart() {
    setPhase('idle');
    setCandidates([]);
    setPage(null);
    setProposals([]);
    setSelected(new Set());
    setPhotoOffer({ kind: 'none' });
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
                {photoOffer.kind !== 'none' && (
                  <li className="rounded border p-2">
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1 size-4"
                        checked={usePhoto}
                        onChange={() => setUsePhoto((prev) => !prev)}
                      />
                      <span className="font-medium">
                        {photoOffer.kind === 'upgrade' ? 'Photo (sharper one found)' : 'Photo'}
                      </span>
                    </label>

                    {/* Both previews come from the already-downloaded image
                        rather than a hotlink, so what is shown is exactly what
                        would be stored. */}
                    <div className="mt-2 flex items-end gap-3">
                      {photoOffer.kind === 'upgrade' && bean.thumbnailDataUrl && (
                        <figure className="m-0">
                          <img
                            src={bean.thumbnailDataUrl}
                            alt="What this coffee shows now"
                            className="size-20 rounded object-cover"
                          />
                          <figcaption className="text-muted-foreground mt-1 text-xs">
                            Yours · {photoOffer.current.widthPx}×{photoOffer.current.heightPx}
                          </figcaption>
                        </figure>
                      )}
                      <figure className="m-0">
                        <img
                          src={photoOffer.staged.thumbnailDataUrl}
                          alt="Found on the roaster's page"
                          className="size-20 rounded object-cover"
                        />
                        <figcaption className="text-muted-foreground mt-1 text-xs">
                          Found · {photoOffer.staged.widthPx}×{photoOffer.staged.heightPx}
                        </figcaption>
                      </figure>
                    </div>

                    {photoOffer.kind === 'upgrade' && (
                      <p className="text-destructive mt-1 text-xs">
                        {photoOffer.ratio.toFixed(1)}× the detail of yours. Applying replaces your
                        current photo — untick to keep it.
                      </p>
                    )}
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
