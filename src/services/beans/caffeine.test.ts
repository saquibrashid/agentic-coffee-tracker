import { describe, expect, it } from 'vitest';
import { CAFFEINE_LABELS, caffeineOf, comparableCaffeine, isDecaf } from './caffeine';
import type { CaffeineLevel } from '@/types';

const bean = (caffeine?: CaffeineLevel) => (caffeine ? { caffeine } : {});

describe('caffeineOf', () => {
  it('reads the stored value', () => {
    expect(caffeineOf(bean('decaf'))).toBe('decaf');
    expect(caffeineOf(bean('half-caf'))).toBe('half-caf');
  });

  it('treats a coffee recorded before the field existed as unknown', () => {
    // Every bean in every existing library has no caffeine key at all. That is
    // the same state as one nobody has answered for, and must never read as
    // "caffeinated" -- that would claim an answer the user never gave.
    expect(caffeineOf(bean())).toBe('unknown');
  });
});

describe('isDecaf', () => {
  it('is true only for decaf', () => {
    expect(isDecaf(bean('decaf'))).toBe(true);
    expect(isDecaf(bean('caffeinated'))).toBe(false);
    expect(isDecaf(bean())).toBe(false);
  });

  it('excludes half-caf', () => {
    // Half-caf is its own product. Folding it into decaf would make the
    // filter and the preference engine disagree about the same bag.
    expect(isDecaf(bean('half-caf'))).toBe(false);
  });
});

describe('comparableCaffeine', () => {
  it('keeps decaf and caffeinated apart', () => {
    expect(comparableCaffeine(bean('decaf'), bean('caffeinated'))).toBe(false);
    expect(comparableCaffeine(bean('half-caf'), bean('decaf'))).toBe(false);
  });

  it('groups like with like', () => {
    expect(comparableCaffeine(bean('decaf'), bean('decaf'))).toBe(true);
    expect(comparableCaffeine(bean('caffeinated'), bean('caffeinated'))).toBe(true);
  });

  it('lets an unlabelled coffee compare with anything', () => {
    // The day this field ships, every existing coffee is unknown. If unknown
    // were its own group, the preference engine would have nothing left to
    // learn from and the user's history would silently evaporate.
    expect(comparableCaffeine(bean(), bean('decaf'))).toBe(true);
    expect(comparableCaffeine(bean('caffeinated'), bean())).toBe(true);
    expect(comparableCaffeine(bean(), bean())).toBe(true);
  });
});

describe('CAFFEINE_LABELS', () => {
  it('has wording for every value, including the absent one', () => {
    const levels: CaffeineLevel[] = ['caffeinated', 'decaf', 'half-caf', 'unknown'];
    for (const level of levels) {
      expect(CAFFEINE_LABELS[level]).toBeTruthy();
    }
    // "unknown" is a gap, not a kind of coffee, so it must not read like one.
    expect(CAFFEINE_LABELS.unknown).toBe('Not known');
  });
});
