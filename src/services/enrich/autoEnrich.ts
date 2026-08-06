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
  return CORE_FIELDS.some((field) => isFieldMissing(bean, field));
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
  const filled = fillMissingFields(bean, parsedBeanToUpdate(page.parsed));
  const fields = Object.keys(filled) as EnrichableField[];
  if (fields.length === 0) return null;

  return {
    update: {
      ...filled,
      sourceUrl: page.sourceUrl,
      llmModel: page.model,
      updatedAt: new Date().toISOString(),
    },
    sourceUrl: page.sourceUrl,
    filled: fields,
  };
}
