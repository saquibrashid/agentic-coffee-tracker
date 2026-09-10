import type { CoffeeBean } from '@/types';

/**
 * What "this coffee is missing details" means, kept free of every dependency.
 *
 * These predicates used to live in `autoEnrich.ts`, which imports the AI client
 * and the photo pipeline. That was fine while only the queue asked the
 * question, but the library's pure filter module needs it too (#246) and must
 * not drag a network client into its tests or its bundle. The logic is
 * unchanged; `autoEnrich` re-exports it so existing call sites are unaffected.
 */

/**
 * The fields auto-enrichment may fill.
 *
 * `roaster` and `name` are excluded because they are the search key — letting a
 * match rewrite them would let a bad hit rename the user's coffee. `roastDate`
 * is excluded because a product page advertises the roaster's *current* batch,
 * which has nothing to do with the bag drunk months ago. `confidence` is
 * excluded because it describes the parse, not the coffee.
 *
 * `composition` is here but deliberately *not* in `CORE_FIELDS` below: plenty
 * of roasters say neither "blend" nor "single origin", so an unknown
 * composition is an ordinary permanent state rather than a gap worth chasing.
 * Filling it when a lookup happens anyway costs nothing; triggering lookups on
 * it would nag about coffees no page can resolve.
 */
export const ENRICHABLE_FIELDS = [
  'origins',
  'process',
  'roastLevel',
  'composition',
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

/**
 * True when a lookup has already read a page for this field and found nothing.
 *
 * Separate from `isFieldMissing` on purpose. The field *is* still missing — the
 * detail page should say so, and `fillMissingFields` must go on treating it as
 * fillable so that a better page found later can still supply it. What this
 * changes is only whether the app keeps *asking*.
 */
export function isFieldUnpublished(bean: CoffeeBean, field: EnrichableField): boolean {
  return (bean.unpublishedFields ?? []).includes(field);
}

/**
 * Missing, and still worth doing something about.
 *
 * This is the predicate every "is this coffee incomplete" question should use.
 * `isFieldMissing` answers a narrower question — is the value absent — and
 * conflating the two is what made a blend nag forever about a process its
 * roaster never printed.
 */
export function isFieldOutstanding(bean: CoffeeBean, field: EnrichableField): boolean {
  return isFieldMissing(bean, field) && !isFieldUnpublished(bean, field);
}

/**
 * The core fields a just-read page failed to supply.
 *
 * Takes the coffee as it stands *after* the lookup's update has been applied,
 * so a field the page did fill is not then marked as unavailable from it.
 */
export function unpublishedAfterLookup(bean: CoffeeBean): EnrichableField[] {
  return CORE_FIELDS.filter((field) => isFieldMissing(bean, field));
}

/** True when the coffee has no usable photo of its own yet. */
export function beanNeedsPhoto(bean: Pick<CoffeeBean, 'photoId'>): boolean {
  return !bean.photoId;
}

/** True when a coffee is missing something worth looking up. */
export function beanNeedsEnrichment(bean: CoffeeBean): boolean {
  // A missing picture is reason enough on its own. An imported row has no
  // photo by definition, and the library is a wall of cards — a coffee with
  // no image is the most visible gap there is, even when its metadata is complete.
  return CORE_FIELDS.some((field) => isFieldOutstanding(bean, field)) || beanNeedsPhoto(bean);
}

/**
 * The user-facing list of what is still missing, for a library badge.
 *
 * Only the core fields plus the photo, because those are the ones that made the
 * coffee count as incomplete in the first place — listing a missing varietal
 * next to them would imply a lookup is pending when none is. A field a lookup
 * has already drawn a blank on is left out for the same reason: naming it would
 * promise a fix that no amount of pressing the button can deliver.
 */
export function describeMissing(bean: CoffeeBean): string[] {
  const labels: Record<string, string> = {
    origins: 'origin',
    process: 'process',
    roastLevel: 'roast level',
    tastingNotes: 'tasting notes',
  };
  const missing = CORE_FIELDS.filter((field) => isFieldOutstanding(bean, field)).map(
    (field) => labels[field] ?? field,
  );
  if (beanNeedsPhoto(bean)) missing.push('photo');
  return missing;
}

/**
 * The badge text, which is not simply the joined list.
 *
 * A bulk-imported row is missing everything, and "Missing origin, process,
 * roast level, tasting notes, photo" is longer than the card is wide — it
 * clipped, which told the user less than a count would. Naming the gaps is only
 * worth the space when there are one or two of them; past that the useful
 * signal is just "this one is bare", and the detail page has the specifics.
 */
export function missingBadgeLabel(bean: CoffeeBean): string | null {
  const missing = describeMissing(bean);
  if (missing.length === 0) return null;
  if (missing.length <= 2) return `Missing ${missing.join(' and ')}`;
  return `Missing ${missing.length} details`;
}
