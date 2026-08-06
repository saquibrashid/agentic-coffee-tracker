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

  it('ranks origins by evidence, not just by best single score', () => {
    const beans = [
      bean('a', { origins: [{ country: 'Ethiopia' }] }),
      bean('b', { origins: [{ country: 'Ethiopia' }] }),
      bean('c', { origins: [{ country: 'Brazil' }] }),
    ];
    const ratings = [
      rating('a', 4),
      rating('b', 4),
      rating('c', 5), // higher average, but only one cup
    ];

    const prefs = computePreferencesFrom(beans, ratings);

    expect(prefs.favoriteOrigins[0]?.value).toBe('Ethiopia');
    expect(prefs.favoriteOrigins[0]?.count).toBe(2);
    expect(prefs.favoriteOrigins[0]?.averageScore).toBe(4);
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
