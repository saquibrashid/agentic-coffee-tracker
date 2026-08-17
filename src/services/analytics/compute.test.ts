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

  describe('category ranking (#202)', () => {
    // The user's own report: "flavor notes shows all flavors with a 9 rating".
    // Every note on their single best coffee tied at the top, because the sort
    // was on the raw average and a note rated once scores whatever that one
    // coffee scored.
    // Both notes sit above the user's own average, so the only thing separating
    // them is how much evidence stands behind each. (Shrinkage deliberately
    // never moves a value across the baseline, so a comparison spanning it
    // would be testing something else.)
    const beans = [
      bean('lucky', { tastingNotes: ['jasmine'] }),
      bean('proven', { tastingNotes: ['chocolate'] }),
      bean('filler', { tastingNotes: ['ash'] }),
    ];
    const ratings = [
      rating('r1', 'lucky', 10, '2026-08-01T00:00:00.000Z'),
      ...Array.from({ length: 6 }, (_, i) =>
        rating(`c${i}`, 'proven', 8.5, `2026-08-0${i + 1}T06:00:00.000Z`),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        rating(`f${i}`, 'filler', 4, `2026-08-0${i + 1}T12:00:00.000Z`),
      ),
    ];

    it('holds back a note backed by a single rating', () => {
      const result = computeAnalyticsFrom(beans, ratings, 'all', now);
      const [first, second] = result.topFlavors;

      // Jasmine has the better raw average and still loses, because one rating
      // is not evidence that the user likes jasmine.
      expect(first?.value).toBe('chocolate');
      expect(second?.value).toBe('jasmine');
      expect(second!.averageScore).toBeGreaterThan(first!.averageScore);
      expect(second!.weightedScore).toBeLessThan(first!.weightedScore);
    });

    it('ranks by the same score the bars are drawn from', () => {
      const result = computeAnalyticsFrom(beans, ratings, 'all', now);
      const scores = result.topFlavors.map((item) => item.weightedScore);

      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    it('reports how many coffees the ratings came from, not just how many there were', () => {
      // "9.0 avg from 6 ratings" reads like six coffees agreeing. Here it is
      // one coffee rated six times, which is a far weaker claim.
      const result = computeAnalyticsFrom(beans, ratings, 'all', now);
      const chocolate = result.topFlavors.find((item) => item.value === 'chocolate');

      expect(chocolate).toMatchObject({ count: 6, beanCount: 1 });
    });

    it('returns every value so the screen can say what it is hiding', () => {
      const many = Array.from({ length: 12 }, (_, i) =>
        bean(`b${i}`, { tastingNotes: [`note-${i}`] }),
      );
      const each = many.map((b, i) => rating(`r${i}`, b.id, 7, '2026-08-01T00:00:00.000Z'));

      const result = computeAnalyticsFrom(many, each, 'all', now);

      expect(result.topFlavors).toHaveLength(12);
    });

    it('shrinks toward the user own average, so a bad note cannot be promoted by volume', () => {
      const disliked = [
        bean('good', { tastingNotes: ['toffee'] }),
        bean('bad', { tastingNotes: ['ash'] }),
      ];
      const mixed = [
        rating('g1', 'good', 9, '2026-08-01T00:00:00.000Z'),
        rating('g2', 'good', 9, '2026-08-02T00:00:00.000Z'),
        ...Array.from({ length: 8 }, (_, i) =>
          rating(`a${i}`, 'bad', 4, `2026-08-0${(i % 8) + 1}T06:00:00.000Z`),
        ),
      ];

      const result = computeAnalyticsFrom(disliked, mixed, 'all', now);
      const ash = result.topFlavors.find((item) => item.value === 'ash');

      expect(result.topFlavors[0]?.value).toBe('toffee');
      expect(ash!.weightedScore).toBeLessThan(result.baseline);
    });
  });
});
