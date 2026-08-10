import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTERS,
  collectFacets,
  countActiveFilters,
  filterAndSortBeans,
  hasActiveFilters,
  summariseBeans,
  type LibraryFilters,
} from './library';
import type { CoffeeBean } from '@/types';

function bean(overrides: Partial<CoffeeBean> & { id: string; name: string }): CoffeeBean {
  return {
    schemaVersion: 1,
    roaster: 'Acme Roasters',
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const filters = (overrides: Partial<LibraryFilters> = {}): LibraryFilters => ({
  ...DEFAULT_FILTERS,
  ...overrides,
});

describe('summariseBeans', () => {
  it('joins ratings to beans in a single pass', () => {
    const result = summariseBeans(
      [bean({ id: 'a', name: 'A' }), bean({ id: 'b', name: 'B' })],
      [
        { beanId: 'a', score: 4 },
        { beanId: 'a', score: 2 },
        { beanId: 'b', score: 5 },
      ],
    );
    expect(result[0]).toMatchObject({ ratingCount: 2, averageScore: 3 });
    expect(result[1]).toMatchObject({ ratingCount: 1, averageScore: 5 });
  });

  it('distinguishes "no ratings" from "average of zero"', () => {
    const [only] = summariseBeans([bean({ id: 'a', name: 'A' })], []);
    expect(only?.averageScore).toBeNull();
    expect(only?.ratingCount).toBe(0);
  });
});

describe('filterAndSortBeans', () => {
  const beans = [
    bean({
      id: 'ethiopia',
      name: 'Yirgacheffe',
      roaster: 'Blue Bottle',
      roastLevel: 'light',
      process: 'washed',
      tastingNotes: ['jasmine', 'bergamot'],
      origins: [{ country: 'Ethiopia', region: 'Yirgacheffe' }],
      createdAt: '2026-03-01T00:00:00.000Z',
    }),
    bean({
      id: 'colombia',
      name: 'Huila',
      roaster: 'Onyx',
      roastLevel: 'medium',
      process: 'natural',
      tastingNotes: ['cherry'],
      origins: [{ country: 'Colombia' }],
      createdAt: '2026-02-01T00:00:00.000Z',
      needsReview: true,
    }),
    bean({
      id: 'archived',
      name: 'Old Bag',
      roaster: 'Acme Roasters',
      createdAt: '2026-01-01T00:00:00.000Z',
      isArchived: true,
    }),
  ];

  const summaries = summariseBeans(beans, [
    { beanId: 'ethiopia', score: 3 },
    { beanId: 'colombia', score: 5 },
  ]);

  function ids(result: ReturnType<typeof filterAndSortBeans>) {
    return result.map((s) => s.bean.id);
  }

  it('hides archived beans by default and shows them on request', () => {
    expect(ids(filterAndSortBeans(summaries, filters()))).toEqual(['ethiopia', 'colombia']);
    expect(ids(filterAndSortBeans(summaries, filters({ includeArchived: true })))).toContain(
      'archived',
    );
  });

  it('searches across name, roaster, origin and tasting notes', () => {
    expect(ids(filterAndSortBeans(summaries, filters({ search: 'onyx' })))).toEqual(['colombia']);
    expect(ids(filterAndSortBeans(summaries, filters({ search: 'jasmine' })))).toEqual([
      'ethiopia',
    ]);
    expect(ids(filterAndSortBeans(summaries, filters({ search: 'Ethiopia' })))).toEqual([
      'ethiopia',
    ]);
  });

  it('narrows rather than widens as more search terms are added', () => {
    // Naive OR-matching would return both beans here.
    expect(ids(filterAndSortBeans(summaries, filters({ search: 'blue yirgacheffe' })))).toEqual([
      'ethiopia',
    ]);
    expect(ids(filterAndSortBeans(summaries, filters({ search: 'blue onyx' })))).toEqual([]);
  });

  it('composes search, filters and sort together', () => {
    const result = filterAndSortBeans(
      summaries,
      filters({ search: 'a', roastLevel: 'medium', process: 'natural', sort: 'name' }),
    );
    expect(ids(result)).toEqual(['colombia']);
  });

  it('treats a missing roast level or process as "unknown"', () => {
    const result = filterAndSortBeans(
      summaries,
      filters({ includeArchived: true, roastLevel: 'unknown' }),
    );
    expect(ids(result)).toEqual(['archived']);
  });

  it('filters to beans the AI flagged for review', () => {
    expect(ids(filterAndSortBeans(summaries, filters({ needsReviewOnly: true })))).toEqual([
      'colombia',
    ]);
  });

  it('sorts by name, newest and rating', () => {
    expect(ids(filterAndSortBeans(summaries, filters({ sort: 'name' })))).toEqual([
      'colombia',
      'ethiopia',
    ]);
    expect(ids(filterAndSortBeans(summaries, filters({ sort: 'newest' })))).toEqual([
      'ethiopia',
      'colombia',
    ]);
    expect(ids(filterAndSortBeans(summaries, filters({ sort: 'rating' })))).toEqual([
      'colombia',
      'ethiopia',
    ]);
  });

  it('sinks unrated beans below rated ones instead of scoring them zero', () => {
    const result = filterAndSortBeans(
      summaries,
      filters({ includeArchived: true, sort: 'rating' }),
    );
    expect(ids(result)).toEqual(['colombia', 'ethiopia', 'archived']);
  });

  it('does not mutate the input array', () => {
    const input = summariseBeans(beans, []);
    const before = input.map((s) => s.bean.id);
    filterAndSortBeans(input, filters({ sort: 'name' }));
    expect(input.map((s) => s.bean.id)).toEqual(before);
  });
});

describe('hasActiveFilters', () => {
  it('is false for the defaults', () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
  });

  it('ignores sort, which never hides results', () => {
    expect(hasActiveFilters(filters({ sort: 'rating' }))).toBe(false);
  });

  it('detects each narrowing control', () => {
    expect(hasActiveFilters(filters({ search: 'x' }))).toBe(true);
    expect(hasActiveFilters(filters({ roastLevel: 'light' }))).toBe(true);
    expect(hasActiveFilters(filters({ process: 'washed' }))).toBe(true);
    expect(hasActiveFilters(filters({ needsReviewOnly: true }))).toBe(true);
    expect(hasActiveFilters(filters({ includeArchived: true }))).toBe(true);
  });

  it('treats whitespace-only search as inactive', () => {
    expect(hasActiveFilters(filters({ search: '   ' }))).toBe(false);
  });
});

describe('countActiveFilters', () => {
  it('is zero for the defaults', () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
  });

  it('counts each multi-select once however many values it holds', () => {
    expect(countActiveFilters(filters({ roasters: ['Onyx'] }))).toBe(1);
    expect(countActiveFilters(filters({ roasters: ['Onyx', 'Tim Wendelboe', 'Sey'] }))).toBe(1);
  });

  it('sums independent constraints', () => {
    const applied = filters({
      search: 'gesha',
      roasters: ['Onyx'],
      origins: ['Ethiopia'],
      minRating: 8,
      roastedWithinDays: 14,
    });
    expect(countActiveFilters(applied)).toBe(5);
  });

  it('ignores sort, which reorders but never hides', () => {
    expect(countActiveFilters(filters({ sort: 'rating' }))).toBe(0);
  });
});

describe('collectFacets', () => {
  const library = [
    bean({ id: '1', name: 'A', roaster: 'Onyx', origins: [{ country: 'Ethiopia' }] }),
    bean({ id: '2', name: 'B', roaster: 'Onyx', origins: [{ country: 'Colombia' }] }),
    bean({ id: '3', name: 'C', roaster: 'Sey', origins: [{ country: 'Ethiopia' }] }),
  ];

  it('derives options from the beans present, not a constant', () => {
    expect(collectFacets(library).roasters.map((o) => o.value)).toEqual(['Onyx', 'Sey']);
  });

  it('orders by frequency so the useful options come first', () => {
    expect(collectFacets(library).origins).toEqual([
      { value: 'Ethiopia', count: 2 },
      { value: 'Colombia', count: 1 },
    ]);
  });

  // Free-text fields mean the same roaster arrives spelled several ways; two
  // options that filter to overlapping sets would be worse than useless.
  it('groups values case-insensitively', () => {
    const facets = collectFacets([
      bean({ id: '1', name: 'A', roaster: 'Onyx' }),
      bean({ id: '2', name: 'B', roaster: 'onyx' }),
      bean({ id: '3', name: 'C', roaster: '  ONYX  ' }),
    ]);
    expect(facets.roasters).toEqual([{ value: 'Onyx', count: 3 }]);
  });

  it('ignores blank and whitespace-only values', () => {
    const facets = collectFacets([
      bean({ id: '1', name: 'A', roaster: 'Onyx', varietals: ['Gesha', '  ', ''] }),
    ]);
    expect(facets.varietals).toEqual([{ value: 'Gesha', count: 1 }]);
  });

  // A blend can list one country twice; counting it twice would misreport how
  // much of the library is behind that option.
  it('counts a bean once per facet even when it repeats a value', () => {
    const facets = collectFacets([
      bean({
        id: '1',
        name: 'Blend',
        origins: [{ country: 'Ethiopia' }, { country: 'ethiopia' }],
        varietals: ['Gesha', 'Gesha'],
      }),
    ]);
    expect(facets.origins).toEqual([{ value: 'Ethiopia', count: 1 }]);
    expect(facets.varietals).toEqual([{ value: 'Gesha', count: 1 }]);
  });

  // Otherwise the control offers a roaster whose every bean is hidden, and
  // selecting it produces an empty list for no visible reason.
  it('excludes archived beans unless they are being shown', () => {
    const withArchived = [
      bean({ id: '1', name: 'A', roaster: 'Onyx' }),
      bean({ id: '2', name: 'B', roaster: 'Gone', isArchived: true }),
    ];
    expect(collectFacets(withArchived).roasters.map((o) => o.value)).toEqual(['Onyx']);
    expect(collectFacets(withArchived, true).roasters.map((o) => o.value)).toEqual([
      'Gone',
      'Onyx',
    ]);
  });

  it('returns empty facets for an empty library', () => {
    expect(collectFacets([])).toEqual({ roasters: [], origins: [], varietals: [] });
  });
});

describe('filterAndSortBeans — attribute filters', () => {
  const library = [
    bean({
      id: 'onyx-eth',
      name: 'Yirgacheffe',
      roaster: 'Onyx',
      origins: [{ country: 'Ethiopia' }],
      varietals: ['Gesha'],
    }),
    bean({
      id: 'sey-col',
      name: 'Huila',
      roaster: 'Sey',
      origins: [{ country: 'Colombia' }],
      varietals: ['Caturra'],
    }),
    bean({
      id: 'onyx-blend',
      name: 'Southern Weather',
      roaster: 'Onyx',
      origins: [{ country: 'Colombia' }, { country: 'Ethiopia' }],
    }),
  ];

  const summaries = () => summariseBeans(library, []);
  const ids = (result: ReturnType<typeof summariseBeans>) => result.map((s) => s.bean.id).sort();

  it('filters by roaster', () => {
    expect(ids(filterAndSortBeans(summaries(), filters({ roasters: ['Onyx'] })))).toEqual([
      'onyx-blend',
      'onyx-eth',
    ]);
  });

  it('matches a roaster regardless of the spelling selected', () => {
    expect(ids(filterAndSortBeans(summaries(), filters({ roasters: ['onyx'] })))).toEqual([
      'onyx-blend',
      'onyx-eth',
    ]);
  });

  // Within one facet the values are alternatives, not requirements: picking two
  // roasters means "either of these", which is what a multi-select implies.
  it('treats several values in one facet as alternatives', () => {
    expect(ids(filterAndSortBeans(summaries(), filters({ roasters: ['Onyx', 'Sey'] })))).toEqual([
      'onyx-blend',
      'onyx-eth',
      'sey-col',
    ]);
  });

  it('matches a blend on any of its origins', () => {
    expect(ids(filterAndSortBeans(summaries(), filters({ origins: ['Ethiopia'] })))).toEqual([
      'onyx-blend',
      'onyx-eth',
    ]);
  });

  it('filters by varietal', () => {
    expect(ids(filterAndSortBeans(summaries(), filters({ varietals: ['Gesha'] })))).toEqual([
      'onyx-eth',
    ]);
  });

  // Across facets they combine, so each additional control narrows.
  it('intersects across different facets', () => {
    const applied = filters({ roasters: ['Onyx'], origins: ['Colombia'] });
    expect(ids(filterAndSortBeans(summaries(), applied))).toEqual(['onyx-blend']);
  });

  it('treats an empty selection as no constraint', () => {
    expect(filterAndSortBeans(summaries(), filters({ roasters: [] }))).toHaveLength(3);
  });

  it('returns nothing when a selected value matches no bean', () => {
    expect(filterAndSortBeans(summaries(), filters({ roasters: ['Nobody'] }))).toHaveLength(0);
  });
});

describe('filterAndSortBeans — rating threshold', () => {
  const library = [
    bean({ id: 'great', name: 'Great' }),
    bean({ id: 'okay', name: 'Okay' }),
    bean({ id: 'unrated', name: 'Unrated' }),
  ];
  const ratings = [
    { beanId: 'great', score: 9 },
    { beanId: 'okay', score: 5 },
  ];
  const summaries = () => summariseBeans(library, ratings);

  it('keeps beans at or above the threshold', () => {
    const result = filterAndSortBeans(summaries(), filters({ minRating: 8 }));
    expect(result.map((s) => s.bean.id)).toEqual(['great']);
  });

  it('is inclusive of the threshold itself', () => {
    const result = filterAndSortBeans(summaries(), filters({ minRating: 9 }));
    expect(result.map((s) => s.bean.id)).toEqual(['great']);
  });

  // The decision issue #109 asked to make explicit: "show me the ones I rated
  // 8+" cannot honestly include coffee with no score at all.
  it('excludes unrated beans, which have no score to compare', () => {
    const result = filterAndSortBeans(summaries(), filters({ minRating: 6 }));
    expect(result.map((s) => s.bean.id)).not.toContain('unrated');
  });

  it('keeps unrated beans when no threshold is set', () => {
    const result = filterAndSortBeans(summaries(), filters({ minRating: null }));
    expect(result.map((s) => s.bean.id)).toContain('unrated');
  });

  it('compares the average rather than any single rating', () => {
    const mixed = summariseBeans(
      [bean({ id: 'mixed', name: 'Mixed' })],
      [
        { beanId: 'mixed', score: 10 },
        { beanId: 'mixed', score: 4 },
      ],
    );
    expect(filterAndSortBeans(mixed, filters({ minRating: 8 }))).toHaveLength(0);
    expect(filterAndSortBeans(mixed, filters({ minRating: 7 }))).toHaveLength(1);
  });
});

describe('filterAndSortBeans — freshness window', () => {
  const now = Date.parse('2026-03-01T00:00:00.000Z');
  const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

  const library = [
    bean({ id: 'fresh', name: 'Fresh', roastDate: daysAgo(3) }),
    bean({ id: 'stale', name: 'Stale', roastDate: daysAgo(60) }),
    bean({ id: 'undated', name: 'Undated' }),
  ];
  const summaries = () => summariseBeans(library, []);

  it('keeps beans roasted inside the window', () => {
    const result = filterAndSortBeans(summaries(), filters({ roastedWithinDays: 14 }), now);
    expect(result.map((s) => s.bean.id)).toEqual(['fresh']);
  });

  it('widens with the window', () => {
    const result = filterAndSortBeans(summaries(), filters({ roastedWithinDays: 90 }), now);
    expect(result.map((s) => s.bean.id).sort()).toEqual(['fresh', 'stale']);
  });

  // Keeping unknowns would answer "show me fresh coffee" with coffee that
  // might be two years old. The UI says so rather than leaving it implied.
  it('excludes beans with no roast date', () => {
    const result = filterAndSortBeans(summaries(), filters({ roastedWithinDays: 90 }), now);
    expect(result.map((s) => s.bean.id)).not.toContain('undated');
  });

  it('excludes an unparseable roast date rather than throwing', () => {
    const broken = summariseBeans([bean({ id: 'x', name: 'X', roastDate: 'soon' })], []);
    expect(filterAndSortBeans(broken, filters({ roastedWithinDays: 30 }), now)).toHaveLength(0);
  });

  // A future roast date is a typo or a pre-order, not the freshest coffee in
  // the library; letting it through would put it top of a freshness filter.
  it('excludes a roast date in the future', () => {
    const future = summariseBeans(
      [bean({ id: 'future', name: 'Future', roastDate: new Date(now + 86_400_000).toISOString() })],
      [],
    );
    expect(filterAndSortBeans(future, filters({ roastedWithinDays: 30 }), now)).toHaveLength(0);
  });

  it('keeps every bean when no window is set', () => {
    expect(filterAndSortBeans(summaries(), filters({ roastedWithinDays: null }), now)).toHaveLength(
      3,
    );
  });
});
