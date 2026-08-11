/**
 * Automatic web enrichment for coffees that arrived without full details —
 * chiefly bulk-imported rows, where a spreadsheet has the roaster, the coffee
 * and a score but none of the origin/process/roast metadata the preference
 * engine actually reasons over.
 *
 * This runs the same search -> scrape -> parse chain as the interactive
 * `EnrichPanel`, with two deliberate differences:
 *
 *  1. It is unattended, so it picks the top search result rather than asking.
 *     That is only safe because of (2).
 *  2. It fills *gaps only*. A value the user typed is never replaced, so the
 *     worst case for a wrong match is some extra metadata on one coffee, not
 *     silent corruption of the history the user just imported.
 */
import { parsedBeanToUpdate } from '@/services/ai/mapping';
import { ApiError } from '@/services/ai';
import type { CoffeeBean } from '@/types';
import { EmptyPageError, enrichFromUrl, findCandidates } from './index';
import { inferRoastLevel } from './inferRoast';
import { attachPhotoFromUrl, beanNeedsPhoto } from './photo';

/**
 * The fields auto-enrichment may fill.
 *
 * `roaster` and `name` are excluded because they are the search key — letting a
 * match rewrite them would let a bad hit rename the user's coffee. `roastDate`
 * is excluded because a product page advertises the roaster's *current* batch,
 * which has nothing to do with the bag drunk months ago. `confidence` is
 * excluded because it describes the parse, not the coffee.
 */
export const ENRICHABLE_FIELDS = [
  'origins',
  'process',
  'roastLevel',
  'varietals',
  'elevationMeters',
  'tastingNotes',
  'roasterDescription',
] as const;

export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

/**
 * The subset whose absence is worth a network round-trip.
 *
 * These are the fields the preference engine actually reasons over, and the ones
 * a spreadsheet plausibly carries. The wider `ENRICHABLE_FIELDS` set is filled
 * opportunistically once a lookup happens, but must not *trigger* one: no CSV
 * has a varietal or elevation column, so gating on those would queue a lookup
 * for every coffee forever, however complete it already is.
 */
export const CORE_FIELDS: readonly EnrichableField[] = [
  'origins',
  'process',
  'roastLevel',
  'tastingNotes',
];

/** Raised when the search found nothing to scrape. Terminal — retrying will not help. */
export class NoCandidatesError extends Error {
  constructor(
    readonly roaster: string,
    readonly coffeeName: string,
  ) {
    super(`No product page found for ${roaster} — ${coffeeName}.`);
    this.name = 'NoCandidatesError';
  }
}

/**
 * `'unknown'` counts as missing: it is the schema's way of saying "not
 * established", so treating it as a real value would permanently block the one
 * lookup that could resolve it.
 */
export function isFieldMissing(bean: CoffeeBean, field: EnrichableField): boolean {
  const value: unknown = bean[field];
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim().length === 0 || value === 'unknown';
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

export function missingFields(bean: CoffeeBean): EnrichableField[] {
  return ENRICHABLE_FIELDS.filter((field) => isFieldMissing(bean, field));
}

/** True when a coffee is missing something worth looking up. */
export function beanNeedsEnrichment(bean: CoffeeBean): boolean {
  // A missing picture is reason enough on its own. An imported row has no
  // photo by definition, and the library is a wall of cards — a coffee with
  // no image is the most visible gap there is, even when its metadata is complete.
  return CORE_FIELDS.some((field) => isFieldMissing(bean, field)) || beanNeedsPhoto(bean);
}

/** Narrows an update to the fields the bean is actually missing. */
export function fillMissingFields(
  bean: CoffeeBean,
  update: Partial<CoffeeBean>,
): Partial<CoffeeBean> {
  const filled: Partial<CoffeeBean> = {};
  for (const field of ENRICHABLE_FIELDS) {
    if (!isFieldMissing(bean, field)) continue;
    const value = update[field];
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    Object.assign(filled, { [field]: value });
  }
  return filled;
}

/**
 * A failure that will still be a failure next time. The queue must drop these
 * instead of retrying them forever with exponential backoff.
 */
export function isTerminalEnrichFailure(err: unknown): boolean {
  if (err instanceof NoCandidatesError || err instanceof EmptyPageError) return true;
  // 4xx other than 429 is our own bad request, not a passing outage.
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429;
}

export interface AutoEnrichResult {
  update: Partial<CoffeeBean>;
  sourceUrl: string;
  filled: EnrichableField[];
  /** True when the lookup also supplied a photo the coffee did not have. */
  photoAttached: boolean;
}

/**
 * Adds a roast level read out of prose, when neither the coffee nor the parse
 * supplies one.
 *
 * Most roasters state the roast in a sentence rather than a labelled field, so
 * the model — instructed not to guess — returns null and the coffee stays
 * `unknown`. That is not merely cosmetic: `preferences/compute.ts` and
 * `predict/predict.ts` both skip `unknown`, so the coffee never contributes to
 * the profile behind recommendations.
 *
 * Runs against the page's text and the coffee's own, since a name like
 * "French Roast" already carries the answer for a row that was bulk-imported
 * with nothing else. `fillMissingFields` still applies afterwards, so this can
 * only ever fill a gap and never overwrite what the user typed.
 */
function withInferredRoast(bean: CoffeeBean, update: Partial<CoffeeBean>): Partial<CoffeeBean> {
  if (update.roastLevel && update.roastLevel !== 'unknown') return update;

  const inferred = inferRoastLevel({
    name: update.name ?? bean.name,
    roasterDescription: update.roasterDescription ?? bean.roasterDescription,
    tastingNotes: update.tastingNotes ?? bean.tastingNotes,
  });

  return inferred ? { ...update, roastLevel: inferred.level } : update;
}

/**
 * Looks the coffee up on the web and returns only the gaps it could close, or
 * `null` when there was nothing to fill or nothing new was found.
 */
export async function autoEnrichBean(bean: CoffeeBean): Promise<AutoEnrichResult | null> {
  if (!beanNeedsEnrichment(bean)) return null;

  const candidates = await findCandidates(bean.roaster, bean.name, 3);
  const best = candidates[0];
  if (!best) throw new NoCandidatesError(bean.roaster, bean.name);

  const page = await enrichFromUrl(best.url);
  const update = withInferredRoast(bean, parsedBeanToUpdate(page.parsed));
  const filled = fillMissingFields(bean, update);
  const fields = Object.keys(filled) as EnrichableField[];

  // Attempted only when the coffee has no picture of its own, so a user photo
  // is never displaced by a stock shot from a storefront.
  const photo =
    page.imageUrl && beanNeedsPhoto(bean) ? await attachPhotoFromUrl(page.imageUrl) : null;

  // A photo alone is worth persisting: a coffee whose metadata was already
  // complete can still be missing the image that makes its library card useful.
  if (fields.length === 0 && !photo) return null;

  return {
    update: {
      ...filled,
      ...(photo ?? {}),
      sourceUrl: page.sourceUrl,
      llmModel: page.model,
      updatedAt: new Date().toISOString(),
    },
    sourceUrl: page.sourceUrl,
    filled: fields,
    photoAttached: photo !== null,
  };
}
