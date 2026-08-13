import { describe, expect, it } from 'vitest';
import {
  dateInputToRatedAt,
  InvalidRatingDateError,
  localDateInputValue,
  ratedAtToDateInput,
} from './date';

describe('rating date helpers', () => {
  it('formats a local calendar date without converting through UTC', () => {
    expect(localDateInputValue(new Date(2026, 0, 2, 23, 30))).toBe('2026-01-02');
  });

  it('creates a stable historical ratedAt instant', () => {
    expect(dateInputToRatedAt('2020-05-04', undefined, '2026-08-13')).toBe(
      '2020-05-04T12:00:00.000Z',
    );
  });

  it('preserves the prior time when correcting an existing rating day', () => {
    expect(dateInputToRatedAt('2020-05-04', '2026-08-13T18:42:11.000Z', '2026-08-13')).toBe(
      '2020-05-04T18:42:11.000Z',
    );
  });

  it('rejects impossible and future dates', () => {
    expect(() => dateInputToRatedAt('2026-02-30', undefined, '2026-08-13')).toThrow(
      InvalidRatingDateError,
    );
    expect(() => dateInputToRatedAt('2026-08-14', undefined, '2026-08-13')).toThrow(
      /cannot be in the future/i,
    );
  });

  it('reads the calendar portion without a timezone shift', () => {
    expect(ratedAtToDateInput('2026-07-01T23:30:00.000-07:00')).toBe('2026-07-01');
  });
});
