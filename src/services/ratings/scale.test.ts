import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORE,
  MAX_SCORE,
  MIN_SCORE,
  SCORE_CHOICES,
  clampScore,
  clampToScale,
  formatOutOf,
  formatScore,
  isValidScore,
  rescaleLegacyScore,
  roundToStep,
} from './scale';

describe('isValidScore', () => {
  it('accepts the endpoints and half-steps in between', () => {
    expect(isValidScore(MIN_SCORE)).toBe(true);
    expect(isValidScore(MAX_SCORE)).toBe(true);
    expect(isValidScore(7.5)).toBe(true);
  });

  it('rejects anything off the scale or off the step', () => {
    expect(isValidScore(0)).toBe(false);
    expect(isValidScore(10.5)).toBe(false);
    expect(isValidScore(7.3)).toBe(false);
    expect(isValidScore(Number.NaN)).toBe(false);
  });
});

describe('rescaleLegacyScore', () => {
  it('doubles a 1-5 score onto the 1-10 scale', () => {
    expect(rescaleLegacyScore(1)).toBe(2);
    expect(rescaleLegacyScore(4)).toBe(8);
    expect(rescaleLegacyScore(5)).toBe(10);
  });

  it('always lands on a value the new scale considers legal', () => {
    for (const legacy of [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
      expect(isValidScore(rescaleLegacyScore(legacy))).toBe(true);
    }
  });

  it('preserves ordering, so a migration cannot reshuffle a history', () => {
    const legacy = [1, 2, 3, 4, 5];
    const migrated = legacy.map(rescaleLegacyScore);
    expect(migrated).toEqual([...migrated].sort((a, b) => a - b));
  });
});

describe('clampScore and roundToStep', () => {
  it('pulls out-of-range values back onto the scale', () => {
    expect(clampScore(-4)).toBe(MIN_SCORE);
    expect(clampScore(99)).toBe(MAX_SCORE);
    expect(clampScore(6.5)).toBe(6.5);
  });

  it('snaps to the nearest half', () => {
    expect(roundToStep(8.24)).toBe(8);
    expect(roundToStep(8.26)).toBe(8.5);
  });
});

describe('clampToScale', () => {
  it('bounds a value without snapping it to a step', () => {
    // The distinction that matters: an estimate is allowed a precision a
    // human-entered rating is not (#200).
    expect(clampToScale(7.41)).toBe(7.41);
    expect(clampToScale(7.71)).toBe(7.71);
    expect(clampToScale(-4)).toBe(MIN_SCORE);
    expect(clampToScale(99)).toBe(MAX_SCORE);
  });

  it('falls back to neutral rather than passing a non-number through', () => {
    expect(clampToScale(Number.NaN)).toBe(5.5);
  });
});

describe('formatting', () => {
  it('drops the decimal on whole numbers but keeps a half', () => {
    expect(formatScore(8)).toBe('8');
    expect(formatScore(8.5)).toBe('8.5');
    expect(formatOutOf(8)).toBe(`8/${MAX_SCORE}`);
  });
});

describe('SCORE_CHOICES', () => {
  it('offers every half-step, best first, and nothing invalid', () => {
    expect(SCORE_CHOICES[0]).toBe(MAX_SCORE);
    expect(SCORE_CHOICES.at(-1)).toBe(MIN_SCORE);
    expect(SCORE_CHOICES).toHaveLength(19);
    expect(SCORE_CHOICES.every(isValidScore)).toBe(true);
  });

  it('offers the default score', () => {
    expect(SCORE_CHOICES).toContain(DEFAULT_SCORE);
  });
});
