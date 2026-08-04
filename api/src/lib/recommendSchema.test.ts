import { describe, expect, it } from 'vitest';
import {
  mockRecommendations,
  validateRecommendations,
  type PreferenceSummary,
} from './recommendSchema';

const summary: PreferenceSummary = {
  favoriteOrigins: [{ value: 'Ethiopia', count: 4, averageScore: 4.5 }],
  favoriteRoasters: [{ value: 'Onyx', count: 3, averageScore: 4.3 }],
  favoriteProcesses: [{ value: 'washed', count: 3, averageScore: 4.2 }],
  favoriteRoastLevels: [{ value: 'light', count: 4, averageScore: 4.4 }],
  favoriteFlavors: [{ value: 'peach', count: 3, averageScore: 4.6 }],
  favoriteBrewTypes: [{ value: 'pour-over', count: 5, averageScore: 4.4 }],
  averageScore: 4.4,
  totalRatings: 6,
};

const valid = {
  recommendations: [
    {
      title: 'Another Ethiopian single origin',
      rationale: 'Your highest-rated origin.',
      basedOn: ['Ethiopia'],
      origin: 'Ethiopia',
      roastLevel: 'light',
      process: null,
      flavorNotes: ['peach'],
    },
  ],
};

describe('validateRecommendations', () => {
  it('accepts a well-formed set', () => {
    expect(validateRecommendations(valid).valid).toBe(true);
  });

  it('accepts an empty set, which means "not enough to say"', () => {
    expect(validateRecommendations({ recommendations: [] }).valid).toBe(true);
  });

  it('rejects a suggestion with no grounding, the hallucination we care about', () => {
    const result = validateRecommendations({
      recommendations: [{ ...valid.recommendations[0], basedOn: [] }],
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors[0]).toContain('basedOn');
  });

  it('rejects empty titles and rationales', () => {
    const result = validateRecommendations({
      recommendations: [{ ...valid.recommendations[0], title: '   ', rationale: '' }],
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors).toHaveLength(2);
  });

  it('rejects a non-array recommendations field', () => {
    expect(validateRecommendations({ recommendations: 'nope' }).valid).toBe(false);
    expect(validateRecommendations(null).valid).toBe(false);
  });

  it('rejects wrong types on optional fields', () => {
    const result = validateRecommendations({
      recommendations: [{ ...valid.recommendations[0], origin: 12, flavorNotes: 'peach' }],
    });
    expect(result.valid).toBe(false);
  });
});

describe('mockRecommendations', () => {
  it('derives suggestions from the summary rather than returning canned text', () => {
    const { recommendations } = mockRecommendations(summary);
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0]?.title).toContain('Ethiopia');
    expect(recommendations.some((r) => r.basedOn.includes('Onyx'))).toBe(true);
  });

  it('produces output that passes its own validator', () => {
    expect(validateRecommendations(mockRecommendations(summary)).valid).toBe(true);
  });

  it('returns nothing when the summary is empty, instead of inventing taste', () => {
    const empty: PreferenceSummary = {
      favoriteOrigins: [],
      favoriteRoasters: [],
      favoriteProcesses: [],
      favoriteRoastLevels: [],
      favoriteFlavors: [],
      favoriteBrewTypes: [],
      averageScore: 0,
      totalRatings: 0,
    };
    expect(mockRecommendations(empty).recommendations).toEqual([]);
  });
});
