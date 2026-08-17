import { describe, expect, it } from 'vitest';
import { buildTasteInsights, getProfileStrength } from './insights';
import { computePreferencesFrom } from './compute';
import type { CoffeeBean, Rating } from '@/types';

function bean(): CoffeeBean {
  return {
    id: 'bean',
    schemaVersion: 1,
    roaster: 'Onyx',
    name: 'Geometry',
    origins: [{ country: 'Ethiopia' }],
    roastLevel: 'light',
    process: 'washed',
    tastingNotes: ['Citrus'],
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function rating(index: number): Rating {
  return {
    id: `rating-${index}`,
    schemaVersion: 2,
    beanId: 'bean',
    score: 8 + index / 2,
    brewType: 'pour-over',
    ratedAt: `2026-01-0${index + 2}T00:00:00.000Z`,
    createdAt: `2026-01-0${index + 2}T00:00:00.000Z`,
    updatedAt: `2026-01-0${index + 2}T00:00:00.000Z`,
  };
}

describe('getProfileStrength', () => {
  it('moves from developing to well defined as evidence grows', () => {
    expect(getProfileStrength(3).label).toBe('Developing');
    expect(getProfileStrength(8).label).toBe('Growing');
    expect(getProfileStrength(15).label).toBe('Well defined');
  });
});

describe('buildTasteInsights', () => {
  it('describes recurring signals with their supporting sample', () => {
    // A signature needs contrast: one coffee rated three times says nothing
    // about which of its attributes the user actually responds to.
    const liked = Array.from({ length: 3 }, (_, i) => ({
      ...bean(),
      id: `liked${i}`,
      origins: [{ country: 'Ethiopia' }],
    }));
    const disliked = Array.from({ length: 3 }, (_, i) => ({
      ...bean(),
      id: `other${i}`,
      origins: [{ country: 'Brazil' }],
      roastLevel: 'dark' as const,
      tastingNotes: ['Tobacco'],
    }));
    const ratings: Rating[] = [
      ...liked.map((b, i) => ({ ...rating(0), id: `l${i}`, beanId: b.id, score: 9 })),
      ...disliked.map((b, i) => ({ ...rating(0), id: `d${i}`, beanId: b.id, score: 5 })),
    ];

    const insights = buildTasteInsights(computePreferencesFrom([...liked, ...disliked], ratings));
    const signature = insights.find((insight) => insight.title === 'Your current signature');

    expect(signature?.body).toContain('Ethiopia');
    expect(signature?.body).not.toContain('Brazil');
    expect(insights.some((insight) => insight.body.includes('across 3 ratings'))).toBe(true);
  });

  it('claims no signature from a single coffee', () => {
    // Every attribute of the only bean sits exactly on the average, so there is
    // no lean to report. Saying otherwise is how #199 read as a bug.
    const insights = buildTasteInsights(
      computePreferencesFrom([bean()], [rating(0), rating(1), rating(2)]),
    );

    expect(insights.some((insight) => insight.title === 'Your current signature')).toBe(false);
  });

  it('does not invent observations for an empty profile', () => {
    expect(buildTasteInsights(computePreferencesFrom([], []))).toEqual([]);
  });

  it('names a recurring disappointment, not just favourites', () => {
    // The only finding here that can change a purchase: something bought
    // repeatedly and enjoyed less than the user's own average.
    const beans = [
      ...Array.from({ length: 3 }, (_, i) => ({
        ...bean(),
        id: `good${i}`,
        tastingNotes: ['jasmine'],
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        ...bean(),
        id: `bad${i}`,
        tastingNotes: ['dark chocolate'],
      })),
    ];
    const ratings: Rating[] = [
      ...Array.from({ length: 3 }, (_, i) => ({
        ...rating(0),
        id: `g${i}`,
        beanId: `good${i}`,
        score: 9,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        ...rating(0),
        id: `b${i}`,
        beanId: `bad${i}`,
        score: 6,
      })),
    ];

    const insights = buildTasteInsights(computePreferencesFrom(beans, ratings));
    const warning = insights.find((insight) => insight.title === 'Recurring disappointment');

    expect(warning).toBeDefined();
    expect(warning?.body).toContain('Dark chocolate');
    expect(warning?.body).toContain('6.0');
  });

  it('stays quiet about a one-off bad cup', () => {
    // One disappointing cup is a bad day, not a pattern worth reporting.
    const beans = [
      ...Array.from({ length: 3 }, (_, i) => ({
        ...bean(),
        id: `good${i}`,
        tastingNotes: ['jasmine'],
      })),
      { ...bean(), id: 'once', tastingNotes: ['tobacco'] },
    ];
    const ratings: Rating[] = [
      ...Array.from({ length: 3 }, (_, i) => ({
        ...rating(0),
        id: `g${i}`,
        beanId: `good${i}`,
        score: 9,
      })),
      { ...rating(0), id: 'o', beanId: 'once', score: 3 },
    ];

    const insights = buildTasteInsights(computePreferencesFrom(beans, ratings));

    expect(insights.some((insight) => insight.body.includes('Tobacco'))).toBe(false);
  });

  it('does not call something a signature when it runs below the average', () => {
    // A category with one value always has a "leader"; that does not make it a
    // preference. Only the flavour here is genuinely liked.
    const beans = [
      { ...bean(), id: 'a', roastLevel: 'dark' as const, tastingNotes: ['jasmine'] },
      { ...bean(), id: 'b', roastLevel: 'dark' as const, tastingNotes: ['jasmine'] },
      { ...bean(), id: 'c', roastLevel: 'dark' as const, tastingNotes: ['jasmine'] },
    ];
    const ratings: Rating[] = [
      { ...rating(0), id: 'r1', beanId: 'a', score: 4 },
      { ...rating(0), id: 'r2', beanId: 'b', score: 4 },
      { ...rating(0), id: 'r3', beanId: 'c', score: 4 },
    ];

    const preferences = computePreferencesFrom(beans, ratings);
    const signature = buildTasteInsights(preferences).find(
      (insight) => insight.title === 'Your current signature',
    );

    // Everything sits exactly on the baseline, so nothing leans anywhere; the
    // sentence must not claim otherwise.
    expect(signature?.body ?? '').not.toContain('Dark roasts');
  });
});
