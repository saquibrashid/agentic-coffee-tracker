import type { CoffeeBean, Process, RoastLevel } from '@/types';

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
  needsReviewOnly: boolean;
  includeArchived: boolean;
  sort: BeanSortKey;
}

export const DEFAULT_FILTERS: LibraryFilters = {
  search: '',
  roastLevel: 'all',
  process: 'all',
  needsReviewOnly: false,
  includeArchived: false,
  sort: 'newest',
};

/** True when the user has narrowed the list in any way. */
export function hasActiveFilters(filters: LibraryFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.roastLevel !== 'all' ||
    filters.process !== 'all' ||
    filters.needsReviewOnly ||
    filters.includeArchived !== DEFAULT_FILTERS.includeArchived
  );
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
  return [bean.name, bean.roaster, ...origins, ...(bean.tastingNotes ?? []), ...(bean.varietals ?? [])]
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
): BeanSummary[] {
  const filtered = summaries.filter(({ bean }) => {
    if (!filters.includeArchived && bean.isArchived) return false;
    if (filters.needsReviewOnly && !bean.needsReview) return false;
    if (filters.roastLevel !== 'all' && (bean.roastLevel ?? 'unknown') !== filters.roastLevel) {
      return false;
    }
    if (filters.process !== 'all' && (bean.process ?? 'unknown') !== filters.process) {
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
