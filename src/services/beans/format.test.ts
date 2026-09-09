import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT, formatLabel, formatOf, hasNotableFormat } from './format';

describe('formatOf', () => {
  it('reads the stored packaging', () => {
    expect(formatOf({ format: 'cometeer' })).toBe('cometeer');
  });

  /*
   * The reason the default lives here rather than in a value written at
   * capture: a coffee saved before this field existed and a plain bag saved
   * today are the same thing, and neither needs a migration to say so.
   */
  it('treats an absent value as whole bean', () => {
    expect(formatOf({})).toBe('whole-bean');
    expect(formatOf({})).toBe(DEFAULT_FORMAT);
  });
});

describe('hasNotableFormat', () => {
  it('is false for the ordinary bag of beans', () => {
    // Labelling nearly every coffee "Whole bean" adds a word that distinguishes
    // nothing, so the screens ask this before saying anything.
    expect(hasNotableFormat({})).toBe(false);
    expect(hasNotableFormat({ format: 'whole-bean' })).toBe(false);
  });

  it('is true for a delivery system worth naming', () => {
    expect(hasNotableFormat({ format: 'cometeer' })).toBe(true);
    expect(hasNotableFormat({ format: 'nespresso' })).toBe(true);
    expect(hasNotableFormat({ format: 'ground' })).toBe(true);
  });
});

describe('formatLabel', () => {
  it('gives a human name rather than the stored token', () => {
    expect(formatLabel({ format: 'k-cup' })).toBe('K-Cup');
    expect(formatLabel({ format: 'whole-bean' })).toBe('Whole bean');
  });

  it('labels an absent value as the default rather than blank', () => {
    expect(formatLabel({})).toBe('Whole bean');
  });
});
