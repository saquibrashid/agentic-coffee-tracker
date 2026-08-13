import { describe, expect, it } from 'vitest';
import { computeAnalyticsFrom } from './compute';
import type { CoffeeBean, Rating } from '@/types';

function bean(id: string, over: Partial<CoffeeBean> = {}): CoffeeBean {
  return {
    id,
    schemaVersion: 1,
    roaster: 'Onyx',
    name: id,
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function rating(id: string, beanId: string, score: number, ratedAt: string, brewType = 'drip') {
  return {
    id,
    schemaVersion: 2,
    beanId,
    score,
    brewType,
    ratedAt,
    createdAt: ratedAt,
    updatedAt: ratedAt,
  } as Rating;
}

describe('computeAnalyticsFrom', () => {
  const now = new Date('2026-08-13T12:00:00.000Z');

  it('computes roaster averages from ratings rather than bean count', () => {
    const beans = [bean('a'), bean('b')];
    const ratings = [
      rating('r1', 'a', 9, '2026-08-10T00:00:00.000Z'),
      rating('r2', 'a', 7, '2026-08-11T00:00:00.000Z'),
      rating('r3', 'b', 5, '2026-08-12T00:00:00.000Z'),
    ];

    const result = computeAnalyticsFrom(beans, ratings, 'all', now);

    expect(result.topRoasters[0]).toMatchObject({
      value: 'Onyx',
      count: 3,
      averageScore: 7,
    });
  });

  it('scopes metrics and compares against the previous period', () => {
    const beans = [bean('a')];
    const ratings = [
      rating('current', 'a', 9, '2026-08-10T00:00:00.000Z'),
      rating('previous', 'a', 7, '2026-07-10T00:00:00.000Z'),
      rating('old', 'a', 3, '2025-01-01T00:00:00.000Z'),
    ];

    const result = computeAnalyticsFrom(beans, ratings, '30d', now);

    expect(result.totalRatings).toBe(1);
    expect(result.averageScore).toBe(9);
    expect(result.averageScoreChange).toBe(2);
  });

  it('builds category metrics from rated coffees', () => {
    const beans = [
      bean('a', {
        origins: [{ country: 'Ethiopia' }],
        roastLevel: 'light',
        tastingNotes: ['Citrus', 'Floral'],
      }),
    ];
    const ratings = [
      rating('r1', 'a', 8, '2026-08-10T00:00:00.000Z', 'pour-over'),
      rating('r2', 'a', 9, '2026-08-11T00:00:00.000Z', 'pour-over'),
    ];

    const result = computeAnalyticsFrom(beans, ratings, 'all', now);

    expect(result.topOrigins[0]).toMatchObject({ value: 'Ethiopia', count: 2 });
    expect(result.topFlavors.map((item) => item.value)).toEqual(['citrus', 'floral']);
    expect(result.brewMethods[0]).toMatchObject({ value: 'pour-over', averageScore: 8.5 });
    expect(result.roastLevels[0]).toMatchObject({ value: 'light', count: 2 });
  });

  it('returns useful empty data without inventing insights', () => {
    const result = computeAnalyticsFrom([], [], '90d', now);
    expect(result.totalRatings).toBe(0);
    expect(result.insights).toEqual([]);
    expect(result.activity).toHaveLength(13);
  });
});
