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
    const preferences = computePreferencesFrom([bean()], [rating(0), rating(1), rating(2)]);
    const insights = buildTasteInsights(preferences);

    expect(insights.some((insight) => insight.title === 'Your current signature')).toBe(true);
    expect(insights.some((insight) => insight.body.includes('across 3 ratings'))).toBe(true);
  });

  it('does not invent observations for an empty profile', () => {
    expect(buildTasteInsights(computePreferencesFrom([], []))).toEqual([]);
  });
});
