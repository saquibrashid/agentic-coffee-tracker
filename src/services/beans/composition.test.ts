import { describe, expect, it } from 'vitest';

import {
  COMPOSITIONS,
  COMPOSITION_LABELS,
  compositionKnown,
  compositionOf,
} from '@/services/beans/composition';

describe('compositionOf', () => {
  it('reads a recorded composition', () => {
    expect(compositionOf({ composition: 'blend' })).toBe('blend');
  });

  it('treats a coffee recorded before the field existed as unknown', () => {
    expect(compositionOf({})).toBe('unknown');
  });

  it('does not assume a default the way caffeine does', () => {
    expect(compositionOf({})).not.toBe('blend');
    expect(compositionOf({})).not.toBe('single-origin');
  });
});

describe('compositionKnown', () => {
  it('is true only when the coffee is one thing or the other', () => {
    expect(compositionKnown({ composition: 'single-origin' })).toBe(true);
    expect(compositionKnown({ composition: 'unknown' })).toBe(false);
    expect(compositionKnown({})).toBe(false);
  });
});

describe('COMPOSITION_LABELS', () => {
  it('labels every value', () => {
    for (const value of COMPOSITIONS) {
      expect(COMPOSITION_LABELS[value]).toBeTruthy();
    }
  });
});
