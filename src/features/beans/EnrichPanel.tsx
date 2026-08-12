/**
 * Web enrichment for an existing bean (specs/ui.md).
 *
 * Search the web for the product page, scrape it, and offer the extracted
 * fields as an opt-in diff. Nothing is written without an explicit choice, and
 * enrichment failing must never get in the way of manual editing.
 */
import { useRef, useState, type FormEvent } from 'react';
import { FileText, Globe, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { db } from '@/services/db';
import { enqueueUpsert } from '@/services/sync/outbox';
import { isSchemaError } from '@/services/ai';
import {
  EmptyPageError,
  EmptyTextError,
  UnreadableDetailsError,
  enrichFromPdf,
  enrichFromText,
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
import { normaliseEnrichUrl } from '@/services/enrich/url';
import type { CoffeeBean } from '@/types';

type Phase =
  'idle' | 'searching' | 'candidates' | 'fetching' | 'reading' | 'review' | 'saving' | 'done';

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
  const [manualUrl, setManualUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const photoOffered = photoOffer.kind !== 'none';
  const applyCount = selected.size + (usePhoto && photoOffered ? 1 : 0);

  function fail(err: unknown, fallback: string) {
    // Enrichment is additive: a failure returns the user to where they were
    // rather than blocking the page they came to use.
    if (err instanceof EmptyPageError) setError(err.message);
    else if (err instanceof EmptyTextError || err instanceof UnreadableDetailsError)
      setError(err.message);
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

  /**
   * The single way into the review step, whatever produced the details.
   *
   * A scraped page, pasted text and a PDF differ only in how the words were
   * obtained; once they exist, the parse, the diff and the choosing are
   * identical. Routing all three through here is what keeps that true — a
   * second review UI for "details without a page" would be the same screen with
   * its own bugs.
   */
  async function enterReview(
    load: () => Promise<EnrichedPage>,
    working: Phase,
    onFailure: Phase,
    failureMessage: string,
  ) {
    setError(null);
    setPhase(working);
    try {
      const enriched = await load();
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
      fail(err, failureMessage);
      setPhase(onFailure);
    }
  }

  async function choose(url: string, onFailure: Phase = 'candidates') {
    await enterReview(() => enrichFromUrl(url), 'fetching', onFailure, 'Could not read that page.');
  }

  /**
   * The way out when the search cannot find a coffee.
   *
   * Automatic lookup can only reach roasters whose storefront it knows how to
   * find, so there will always be coffees it misses. Someone who has the
   * product page open in another tab should never be stuck: pasting the link
   * skips the search entirely and goes straight to reading the page, which is
   * the part that was always going to do the real work.
   */
  function submitManualUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = normaliseEnrichUrl(manualUrl);
    if (!url) {
      setError('That does not look like a web address. Paste the whole link to the product page.');
      return;
    }
    void choose(url, phase);
  }

  /**
   * The last resort, for a coffee with no page anywhere.
   *
   * Pasting the address still assumes a page exists to point at. Some coffees
   * have none — a roaster with no storefront, a subscription insert, a card in
   * the box — and for those the details are only ever going to arrive as text
   * the user gathered themselves. Parsing never needed a web page, so this is
   * the same machinery with the fetching step removed.
   */
  function submitPastedText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = pastedText;
    void enterReview(
      () => enrichFromText(text),
      'reading',
      phase,
      'Could not make sense of those details.',
    );
  }

  function submitPdf(file: File | undefined) {
    if (!file) return;
    const before = phase;
    void enterReview(
      () => enrichFromPdf(file),
      'reading',
      before,
      'Could not read that PDF.',
    ).finally(() => {
      // Cleared so picking the same file again still fires a change event.
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    });
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
    const update = applyProposals(page.parsed, selected, {
      // Omitted rather than blanked when there is no page: pasted details should
      // not erase the address a coffee was previously enriched from.
      ...(page.sourceUrl ? { sourceUrl: page.sourceUrl } : {}),
    });

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
    setManualUrl('');
    setPastedText('');
    setShowPaste(false);
    setError(null);
  }

  const manualUrlForm = (
    <form className="space-y-2 border-t pt-3" onSubmit={submitManualUrl}>
      <Label htmlFor={`enrich-url-${bean.id}`} className="text-xs">
        Or paste the product page address
      </Label>
      <div className="flex gap-2">
        <Input
          id={`enrich-url-${bean.id}`}
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="https://roaster.com/products/…"
          value={manualUrl}
          onChange={(event) => setManualUrl(event.target.value)}
        />
        <Button type="submit" variant="outline" size="sm" disabled={manualUrl.trim() === ''}>
          Read page
        </Button>
      </div>
    </form>
  );

  const noPageForm = (
    <div className="space-y-2 border-t pt-3">
      {showPaste ? (
        <form className="space-y-2" onSubmit={submitPastedText}>
          <Label htmlFor={`enrich-text-${bean.id}`} className="text-xs">
            Paste anything describing this coffee
          </Label>
          <Textarea
            id={`enrich-text-${bean.id}`}
            rows={5}
            placeholder="Origin, process, roast level, tasting notes — however it is written."
            value={pastedText}
            onChange={(event) => setPastedText(event.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="outline" size="sm" disabled={pastedText.trim() === ''}>
              Read details
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowPaste(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            No page for this coffee anywhere? Use what you have.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowPaste(true)}>
              <FileText aria-hidden="true" /> Paste details
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => pdfInputRef.current?.click()}
            >
              <FileText aria-hidden="true" /> Upload a PDF
            </Button>
          </div>
        </>
      )}
      {/*
        Driven by the button so it reads as one of the pair rather than a stray
        file control, but still labelled and reachable in its own right.
      */}
      <input
        ref={pdfInputRef}
        id={`enrich-pdf-${bean.id}`}
        aria-label="Upload a PDF"
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={(event) => submitPdf(event.target.files?.[0])}
      />
    </div>
  );

  /*
   * No box and no heading of its own: this renders inside a CollapsibleCard on
   * the bean page, which supplies both. Nesting a bordered section inside a
   * bordered card was one of the things making that page look busy.
   */
  return (
    <div>
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
          {manualUrlForm}
          {noPageForm}
        </div>
      )}

      {(phase === 'searching' ||
        phase === 'fetching' ||
        phase === 'reading' ||
        phase === 'saving') && (
        <p role="status" className="text-muted-foreground mt-2 flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {phase === 'searching' && 'Searching…'}
          {phase === 'fetching' && 'Reading that page…'}
          {phase === 'reading' && 'Reading those details…'}
          {phase === 'saving' && 'Saving the photo…'}
        </p>
      )}

      {phase === 'candidates' && (
        <div className="mt-2 space-y-2">
          {candidates.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No results for this coffee. If you can find its page on the roaster&rsquo;s site,
              paste the address below and we will read it.
            </p>
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
          {manualUrlForm}
          {noPageForm}
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
              <p className="text-muted-foreground text-xs break-all">
                {page.sourceUrl ? `Source: ${page.sourceUrl}` : 'From the details you supplied.'}
              </p>
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
    </div>
  );
}
