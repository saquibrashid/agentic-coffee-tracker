import { describe, expect, it } from 'vitest';
import { computePreferencesFrom, hasEnoughHistory } from './compute';
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

function rating(beanId: string, score: number, over: Partial<Rating> = {}): Rating {
  return {
    id: `${beanId}-${score}-${Math.random()}`,
    schemaVersion: 2,
    beanId,
    score,
    brewType: 'espresso',
    ratedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

describe('computePreferencesFrom', () => {
  it('returns an empty, well-formed profile with no history', () => {
    const prefs = computePreferencesFrom([], []);
    expect(prefs.totalRatings).toBe(0);
    expect(prefs.averageScore).toBe(0);
    expect(prefs.favoriteOrigins).toEqual([]);
    expect(prefs.id).toBe('singleton');
  });

  it('never lets volume promote a value the user rates below their own average', () => {
    // The reported bug (#199): "dark chocolate" led the flavour list at 6.5
    // across 8 cups while "chocolate" sat below it at 9.0 across 2, because the
    // old formula multiplied the score by a count term.
    const beans = [
      ...Array.from({ length: 8 }, (_, i) => bean(`d${i}`, { tastingNotes: ['dark chocolate'] })),
      ...Array.from({ length: 2 }, (_, i) => bean(`c${i}`, { tastingNotes: ['chocolate'] })),
    ];
    const ratings = [
      ...Array.from({ length: 8 }, (_, i) => rating(`d${i}`, 6.5)),
      ...Array.from({ length: 2 }, (_, i) => rating(`c${i}`, 9)),
    ];

    const prefs = computePreferencesFrom(beans, ratings);
    const [first, second] = prefs.favoriteFlavors;

    expect(first?.value).toBe('chocolate');
    expect(second?.value).toBe('dark chocolate');
    // The one below the 7.0 baseline stays below it however many cups back it.
    expect(second?.weightedScore).toBeLessThan(prefs.averageScore);
    expect(first?.weightedScore).toBeGreaterThan(prefs.averageScore);
  });

  it('still holds back a single top-marks cup', () => {
    // Shrinkage has to keep the other half of the bargain: one perfect cup is
    // not yet a preference, so it must not leap over a well-evidenced value that
    // also runs above the baseline.
    const beans = [
      ...Array.from({ length: 6 }, (_, i) => bean(`c${i}`, { tastingNotes: ['citrus'] })),
      bean('j', { tastingNotes: ['juniper'] }),
      ...Array.from({ length: 10 }, (_, i) => bean(`f${i}`)),
    ];
    const ratings = [
      ...Array.from({ length: 6 }, (_, i) => rating(`c${i}`, 9)),
      rating('j', 10),
      ...Array.from({ length: 10 }, (_, i) => rating(`f${i}`, 6)),
    ];

    const prefs = computePreferencesFrom(beans, ratings);

    expect(prefs.favoriteFlavors[0]?.value).toBe('citrus');
    expect(prefs.favoriteFlavors[1]?.value).toBe('juniper');
    // Both are genuinely liked; the ordering is about how much is known.
    expect(prefs.favoriteFlavors[1]?.averageScore).toBeGreaterThan(
      prefs.favoriteFlavors[0]?.averageScore ?? 0,
    );
  });

  it('reports the shrunk score on the same 1-10 scale as the average', () => {
    const beans = [bean('a', { origins: [{ country: 'Peru' }] })];
    const prefs = computePreferencesFrom(beans, [rating('a', 10)]);
    const peru = prefs.favoriteOrigins[0];

    // One cup at 10 against a baseline of 10 stays 10; the point is that the
    // field is a score, not a score times a count.
    expect(peru?.weightedScore).toBeCloseTo(10, 5);
    expect(peru?.weightedScore).toBeLessThanOrEqual(10);
  });

  it('counts a multi-origin blend towards every country', () => {
    const beans = [bean('a', { origins: [{ country: 'Kenya' }, { country: 'Colombia' }] })];
    const prefs = computePreferencesFrom(beans, [rating('a', 5)]);
    expect(prefs.favoriteOrigins.map((o) => o.value).sort()).toEqual(['Colombia', 'Kenya']);
  });

  it('normalises flavour casing so "Citrus" and "citrus" are one preference', () => {
    const beans = [
      bean('a', { tastingNotes: ['Citrus'] }),
      bean('b', { tastingNotes: ['citrus'] }),
    ];
    const prefs = computePreferencesFrom(beans, [rating('a', 4), rating('b', 5)]);
    expect(prefs.favoriteFlavors).toHaveLength(1);
    expect(prefs.favoriteFlavors[0]).toMatchObject({ value: 'citrus', count: 2 });
  });

  it('ignores "unknown" process and roast level rather than ranking them', () => {
    const beans = [bean('a', { process: 'unknown', roastLevel: 'unknown' })];
    const prefs = computePreferencesFrom(beans, [rating('a', 5)]);
    expect(prefs.favoriteProcesses).toEqual([]);
    expect(prefs.favoriteRoastLevels).toEqual([]);
  });

  it('still counts brew type when the bean was deleted', () => {
    const prefs = computePreferencesFrom([], [rating('ghost', 4, { brewType: 'pour-over' })]);
    expect(prefs.favoriteBrewTypes[0]?.value).toBe('pour-over');
    expect(prefs.totalRatings).toBe(1);
  });

  it('computes the overall average across all ratings', () => {
    const beans = [bean('a')];
    const prefs = computePreferencesFrom(beans, [rating('a', 3), rating('a', 5)]);
    expect(prefs.averageScore).toBe(4);
  });

  it('caps each ranking at five entries', () => {
    const beans = Array.from({ length: 8 }, (_, i) =>
      bean(`b${i}`, { origins: [{ country: `Country${i}` }] }),
    );
    const ratings = beans.map((b) => rating(b.id, 4));
    expect(computePreferencesFrom(beans, ratings).favoriteOrigins).toHaveLength(5);
  });
});

describe('hasEnoughHistory', () => {
  it('requires at least three ratings', () => {
    expect(hasEnoughHistory(undefined)).toBe(false);
    expect(hasEnoughHistory(computePreferencesFrom([], []))).toBe(false);
    const beans = [bean('a')];
    const prefs = computePreferencesFrom(beans, [rating('a', 4), rating('a', 4), rating('a', 4)]);
    expect(hasEnoughHistory(prefs)).toBe(true);
  });
});
