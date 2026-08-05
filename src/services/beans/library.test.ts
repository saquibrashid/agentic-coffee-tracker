import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTERS,
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
    expect(ids(filterAndSortBeans(summaries, filters({ search: 'jasmine' })))).toEqual(['ethiopia']);
    expect(ids(filterAndSortBeans(summaries, filters({ search: 'Ethiopia' })))).toEqual(['ethiopia']);
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
