/**
 * The single definition of what a coffee's origins are once duplicates are
 * accounted for.
 *
 * A blend legitimately lists one country more than once: "Fast Forward" is half
 * Manos Campesinas and half Finca La Hermosa, both in Guatemala. Two entries is
 * the correct record of that coffee. What is not correct is treating it as two
 * pieces of evidence about Guatemala — one rating of one blend is one
 * observation, however many lots went into the bag (#297).
 *
 * Everything that ranks, averages or recommends reads the rule from here.
 * `services/preferences/compute.ts`, the Analytics screen and `predict` rank the
 * same values from the same ratings and have to agree (#202); three copies of
 * this loop is exactly how that agreement is lost. `beans/library.ts` reached
 * the same conclusion independently for its facet counts, which is what this
 * module generalises.
 */
import type { Origin } from '@/types';

/** How a country name is compared. Matching `library.ts`'s facet dedupe. */
function countryKey(country: string): string {
  return country.trim().toLowerCase();
}

/**
 * Each country a coffee comes from, once, in the order first listed.
 *
 * The trimmed spelling of the first mention is what comes back, so callers key
 * their accumulators on a value a user could read. Blank countries are dropped
 * rather than counted as an empty bucket.
 */
export function uniqueOriginCountries(origins: readonly Origin[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const origin of origins ?? []) {
    const country = origin.country?.trim();
    if (!country || seen.has(countryKey(country))) continue;
    seen.add(countryKey(country));
    out.push(country);
  }
  return out;
}

/**
 * Origins with exact repeats collapsed.
 *
 * Deliberately conservative: entries are merged only when every field agrees,
 * which cannot lose information, so it is safe to apply on read to records that
 * were stored before this existed. Two lots from one country that differ by farm
 * are *not* the same origin and stay as two — see `formatOriginList` for how
 * they are told apart on screen.
 */
export function dedupeOrigins(origins: readonly Origin[] | undefined): Origin[] {
  const seen = new Set<string>();
  const out: Origin[] = [];
  for (const origin of origins ?? []) {
    const key = JSON.stringify([
      countryKey(origin.country ?? ''),
      origin.region?.trim().toLowerCase() ?? null,
      origin.farm?.trim().toLowerCase() ?? null,
      origin.producer?.trim().toLowerCase() ?? null,
      origin.percentage ?? null,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(origin);
  }
  return out;
}

/**
 * Country plus whichever narrowing detail the roaster gave, e.g.
 * "Colombia (Huila)".
 *
 * Farm and producer stay out: they are long, and a blend would run several of
 * them into an unreadable line. The one exception is a collision — when two
 * entries would otherwise render as the identical string, the line is already
 * broken, and "Guatemala, Guatemala" tells the user strictly less than the farm
 * would. So the detail is added back only to the entries that need it, and only
 * enough of them to tell those entries apart.
 */
export function formatOriginList(origins: readonly Origin[] | undefined): string {
  const list = dedupeOrigins(origins);

  const base = list.map((origin) => (origin.region ? [origin.region] : []));
  const rendered = list.map((origin, index) => render(origin, base[index] ?? []));

  const counts = new Map<string, number>();
  for (const text of rendered) counts.set(text, (counts.get(text) ?? 0) + 1);

  return list
    .map((origin, index) => {
      const text = rendered[index] ?? '';
      if ((counts.get(text) ?? 0) < 2) return text;
      const detail = origin.farm?.trim() || origin.producer?.trim();
      return detail ? render(origin, [...(base[index] ?? []), detail]) : text;
    })
    .join(', ');
}

function render(origin: Origin, parts: string[]): string {
  const place = parts.length > 0 ? `${origin.country} (${parts.join(' · ')})` : origin.country;
  return origin.percentage !== undefined ? `${place} ${origin.percentage}%` : place;
}

/**
 * Applies an edited list of country names to the origins a coffee already has.
 *
 * The confirm screen offers origins as a comma-separated list of countries,
 * which is a convenience for correcting a misread country rather than a claim
 * that the coffee has no farm. Rebuilding the list from that text discarded
 * `region`, `farm`, `producer` and `percentage` from every entry, silently, on
 * every save (#304).
 *
 * So a country the coffee already had keeps the entries it already had — all of
 * them, because a blend of two Guatemalan lots shows "Guatemala" once but is
 * still two origins. A country the user added is new and bare, because there is
 * nothing else known about it yet. A country they removed goes, along with
 * whatever detail hung off it, which is what removing it means.
 *
 * Matching ignores case, so retyping a country in lower case is an edit to
 * nothing and keeps the stored spelling.
 */
export function mergeOriginEdits(
  original: readonly Origin[] | undefined,
  countries: readonly string[],
): Origin[] {
  const byCountry = new Map<string, Origin[]>();
  for (const origin of original ?? []) {
    const key = countryKey(origin.country ?? '');
    if (!key) continue;
    byCountry.set(key, [...(byCountry.get(key) ?? []), origin]);
  }

  const out: Origin[] = [];
  for (const country of uniqueOriginCountries(countries.map((value) => ({ country: value })))) {
    const existing = byCountry.get(countryKey(country));
    if (existing) out.push(...existing);
    else out.push({ country });
  }
  return out;
}
