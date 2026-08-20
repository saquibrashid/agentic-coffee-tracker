import type { CoffeeBean, Process, RoastLevel } from '@/types';
import { beanNeedsEnrichment } from '@/services/enrich/completeness';

/**
 * Pure filter/sort/search logic for the bean library (specs/ui.md).
 *
 * Kept free of React and Dexie so the combination rules — which are where the
 * bugs live — can be tested directly rather than through the DOM.
 */

export const ROAST_LEVELS: RoastLevel[] = [
  'light',
  'medium-light',
  'medium',
  'medium-dark',
  'dark',
  'unknown',
];

export const PROCESSES: Process[] = [
  'washed',
  'natural',
  'honey',
  'anaerobic',
  'wet-hulled',
  'other',
  'unknown',
];

export type BeanSortKey = 'newest' | 'name' | 'rating';

export const SORT_OPTIONS: Array<{ value: BeanSortKey; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'rating', label: 'Highest rated' },
];

/**
 * Freshness windows, expressed in days against `roastDate`.
 *
 * Roast date is captured precisely because coffee has a useful life, so the
 * options are the ones people actually reason in: the first fortnight, the
 * first month, the first season.
 */
export const FRESHNESS_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 14, label: 'Roasted in the last 2 weeks' },
  { value: 30, label: 'Roasted in the last month' },
  { value: 90, label: 'Roasted in the last 3 months' },
];

/** Minimum-average-rating thresholds on the 1–10 scale. */
export const RATING_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 6, label: '6+' },
  { value: 7, label: '7+' },
  { value: 8, label: '8+' },
  { value: 9, label: '9+' },
];

/** A bean joined with the aggregate of its ratings. */
export interface BeanSummary {
  bean: CoffeeBean;
  ratingCount: number;
  /** Null when the bean has no ratings — distinct from an average of zero. */
  averageScore: number | null;
}

export interface LibraryFilters {
  search: string;
  roastLevel: RoastLevel | 'all';
  process: Process | 'all';
  /**
   * Multi-select facets. Empty means "no constraint", never "match nothing" —
   * an empty array is the natural state, so treating it as an exclusion would
   * hide the whole library by default.
   *
   * Values are compared case-insensitively but stored as the user sees them,
   * because these are free text: "Onyx" and "onyx" are one roaster.
   */
  roasters: string[];
  origins: string[];
  varietals: string[];
  /** Minimum average score on the 1–10 scale, or null for no threshold. */
  minRating: number | null;
  /** Roasted within this many days, or null for no window. */
  roastedWithinDays: number | null;
  needsReviewOnly: boolean;
  /**
   * Coffees still missing a roast level, process, origin, tasting notes or
   * photo — the same predicate Settings counts for "Fill in missing details".
   *
   * Distinct from `needsReviewOnly`, which is about a parse the user has not
   * confirmed. A coffee can need review while being complete, and be incomplete
   * while never having needed review, so one filter could not serve both. The
   * Settings count linked nowhere before (#246): it said four coffees were
   * incomplete and gave no way to find out which four.
   */
  incompleteOnly: boolean;
  includeArchived: boolean;
  sort: BeanSortKey;
}

export const DEFAULT_FILTERS: LibraryFilters = {
  search: '',
  roastLevel: 'all',
  process: 'all',
  roasters: [],
  origins: [],
  varietals: [],
  minRating: null,
  roastedWithinDays: null,
  needsReviewOnly: false,
  incompleteOnly: false,
  includeArchived: false,
  sort: 'newest',
};

/** True when the user has narrowed the list in any way. */
export function hasActiveFilters(filters: LibraryFilters): boolean {
  return countActiveFilters(filters) > 0;
}

/**
 * How many constraints are applied, for the badge on the collapsed disclosure.
 *
 * Sort is excluded on purpose: it reorders the list but never removes anything,
 * so counting it would report "1 filter" over a list that is showing every
 * bean. Each multi-select counts once however many values it holds — the
 * number is meant to answer "how much am I hiding?", not "how many chips".
 */
export function countActiveFilters(filters: LibraryFilters): number {
  let count = 0;
  if (filters.search.trim() !== '') count += 1;
  if (filters.roastLevel !== 'all') count += 1;
  if (filters.process !== 'all') count += 1;
  if (filters.roasters.length > 0) count += 1;
  if (filters.origins.length > 0) count += 1;
  if (filters.varietals.length > 0) count += 1;
  if (filters.minRating !== null) count += 1;
  if (filters.roastedWithinDays !== null) count += 1;
  if (filters.needsReviewOnly) count += 1;
  if (filters.incompleteOnly) count += 1;
  if (filters.includeArchived !== DEFAULT_FILTERS.includeArchived) count += 1;
  return count;
}

/** A selectable value with the number of beans behind it. */
export interface FacetOption {
  value: string;
  count: number;
}

export interface LibraryFacets {
  roasters: FacetOption[];
  origins: FacetOption[];
  varietals: FacetOption[];
}

function addFacet(into: Map<string, FacetOption>, raw: string | undefined): void {
  const value = raw?.trim();
  if (!value) return;
  const key = value.toLowerCase();
  const existing = into.get(key);
  // First spelling seen wins the display label. Arbitrary, but stable, and it
  // avoids showing "onyx" and "Onyx" as two separate options.
  if (existing) existing.count += 1;
  else into.set(key, { value, count: 1 });
}

function sortFacet(map: Map<string, FacetOption>): FacetOption[] {
  return [...map.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * Derives the available filter values from the beans themselves.
 *
 * Roaster, origin and varietal are free text, so unlike roast level and process
 * there is no closed list to draw on. Options computed from a constant would
 * fill the control with values that match nothing and omit the ones the user
 * actually has.
 *
 * Archived beans are included only when they are being shown, so the options
 * cannot offer a roaster whose every bean is hidden.
 */
export function collectFacets(beans: CoffeeBean[], includeArchived = false): LibraryFacets {
  const roasters = new Map<string, FacetOption>();
  const origins = new Map<string, FacetOption>();
  const varietals = new Map<string, FacetOption>();

  for (const bean of beans) {
    if (!includeArchived && bean.isArchived) continue;

    addFacet(roasters, bean.roaster);

    // A bean can list the same country twice (two lots, one origin), which
    // must not count twice or the option ordering misreports the library.
    const seenCountries = new Set<string>();
    for (const origin of bean.origins ?? []) {
      const country = origin.country?.trim();
      if (!country || seenCountries.has(country.toLowerCase())) continue;
      seenCountries.add(country.toLowerCase());
      addFacet(origins, country);
    }

    const seenVarietals = new Set<string>();
    for (const varietal of bean.varietals ?? []) {
      const value = varietal.trim();
      if (!value || seenVarietals.has(value.toLowerCase())) continue;
      seenVarietals.add(value.toLowerCase());
      addFacet(varietals, value);
    }
  }

  return {
    roasters: sortFacet(roasters),
    origins: sortFacet(origins),
    varietals: sortFacet(varietals),
  };
}

/** Case-insensitive membership, with an empty selection meaning "no constraint". */
function matchesAny(selected: string[], values: Array<string | undefined>): boolean {
  if (selected.length === 0) return true;
  const wanted = new Set(selected.map((value) => value.toLowerCase()));
  return values.some((value) => {
    const trimmed = value?.trim().toLowerCase();
    return trimmed !== undefined && trimmed !== '' && wanted.has(trimmed);
  });
}

/**
 * Whether a bean was roasted within `days` of `now`.
 *
 * A bean with no roast date is **excluded** when the window is active. The
 * alternative — keeping unknowns — would answer "show me fresh coffee" with a
 * list of coffee that might be two years old. The UI states this rather than
 * leaving the user to infer it.
 */
function withinRoastWindow(bean: CoffeeBean, days: number, now: number): boolean {
  if (!bean.roastDate) return false;
  const roasted = Date.parse(bean.roastDate);
  if (Number.isNaN(roasted)) return false;
  return now - roasted <= days * 24 * 60 * 60 * 1000 && roasted <= now;
}

/**
 * Joins beans to their ratings. Done in one pass over the ratings rather than
 * a query per bean, because the whole library is already in memory and the
 * per-bean version would be O(n) IndexedDB round-trips.
 */
export function summariseBeans(
  beans: CoffeeBean[],
  ratings: Array<{ beanId: string; score: number }>,
): BeanSummary[] {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const rating of ratings) {
    const entry = totals.get(rating.beanId) ?? { sum: 0, count: 0 };
    entry.sum += rating.score;
    entry.count += 1;
    totals.set(rating.beanId, entry);
  }

  return beans.map((bean) => {
    const entry = totals.get(bean.id);
    return {
      bean,
      ratingCount: entry?.count ?? 0,
      averageScore: entry && entry.count > 0 ? entry.sum / entry.count : null,
    };
  });
}

function searchableText(bean: CoffeeBean): string {
  const origins = (bean.origins ?? []).flatMap((origin) =>
    [origin.country, origin.region, origin.farm, origin.producer].filter(
      (part): part is string => typeof part === 'string',
    ),
  );
  return [
    bean.name,
    bean.roaster,
    ...origins,
    ...(bean.tastingNotes ?? []),
    ...(bean.varietals ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * Every term must match somewhere in the bean, so typing more words narrows the
 * result set rather than widening it — which is what users expect from a search
 * box even though it is the opposite of a naive OR implementation.
 */
function matchesSearch(bean: CoffeeBean, search: string): boolean {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = searchableText(bean);
  return terms.every((term) => haystack.includes(term));
}

export function filterAndSortBeans(
  summaries: BeanSummary[],
  filters: LibraryFilters,
  // Injected so freshness tests are not tied to the wall clock.
  now: number = Date.now(),
): BeanSummary[] {
  const filtered = summaries.filter(({ bean, averageScore }) => {
    if (!filters.includeArchived && bean.isArchived) return false;
    if (filters.needsReviewOnly && !bean.needsReview) return false;
    if (filters.incompleteOnly && !beanNeedsEnrichment(bean)) return false;
    if (filters.roastLevel !== 'all' && (bean.roastLevel ?? 'unknown') !== filters.roastLevel) {
      return false;
    }
    if (filters.process !== 'all' && (bean.process ?? 'unknown') !== filters.process) {
      return false;
    }
    if (!matchesAny(filters.roasters, [bean.roaster])) return false;
    if (
      !matchesAny(
        filters.origins,
        (bean.origins ?? []).map((origin) => origin.country),
      )
    ) {
      return false;
    }
    if (!matchesAny(filters.varietals, bean.varietals ?? [])) return false;

    // An unrated bean is excluded by a minimum-rating filter. "Show me the ones
    // I scored 8 or better" cannot honestly include coffee that has no score;
    // treating null as passing would fill the result with unknowns.
    if (filters.minRating !== null && (averageScore === null || averageScore < filters.minRating)) {
      return false;
    }

    if (
      filters.roastedWithinDays !== null &&
      !withinRoastWindow(bean, filters.roastedWithinDays, now)
    ) {
      return false;
    }

    return matchesSearch(bean, filters.search);
  });

  const sorted = [...filtered];
  switch (filters.sort) {
    case 'name':
      sorted.sort((a, b) => a.bean.name.localeCompare(b.bean.name));
      break;
    case 'rating':
      // Unrated beans sink to the bottom instead of being treated as zero-star,
      // then fall back to newest so the tail stays in a stable, useful order.
      sorted.sort((a, b) => {
        const scoreA = a.averageScore ?? -1;
        const scoreB = b.averageScore ?? -1;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return b.bean.createdAt.localeCompare(a.bean.createdAt);
      });
      break;
    case 'newest':
    default:
      sorted.sort((a, b) => b.bean.createdAt.localeCompare(a.bean.createdAt));
      break;
  }
  return sorted;
}
