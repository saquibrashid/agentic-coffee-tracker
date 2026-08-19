import { describe, expect, it } from 'vitest';
import { flavourFamily, originFamily, PROCESS_NEIGHBOUR_DISCOUNT, PROCESS_ORDER } from './families';

describe('flavourFamily', () => {
  it('groups notes a roaster writes differently but a drinker tastes alike', () => {
    expect(flavourFamily('blueberry')).toBe('Berry');
    expect(flavourFamily('Blackcurrant')).toBe('Berry');
    expect(flavourFamily('dark chocolate')).toBe('Chocolate');
    expect(flavourFamily('cocoa nibs')).toBe('Chocolate');
  });

  it('reads the note as a phrase rather than as a bag of words', () => {
    // "green" alone is savoury, but "green apple" is not a vegetable. The
    // longest keyword has to win or the table's key order silently decides.
    expect(flavourFamily('green apple')).toBe('Apple & pear');
    expect(flavourFamily('green apple co-ferment')).toBe('Apple & pear');
    expect(flavourFamily('grassy')).toBe('Savoury & earthy');
  });

  it('matches whole words only', () => {
    // The hazard the word boundaries exist for: "pineapple" contains "apple"
    // but belongs nowhere near it.
    expect(flavourFamily('pineapple')).toBe('Tropical fruit');
  });

  it('ignores case, punctuation and spacing', () => {
    expect(flavourFamily('  BROWN-SUGAR ')).toBe('Caramel & sugar');
  });

  it('returns null for vocabulary it does not know', () => {
    // Unrecognised notes must fall through so the predictor reports them
    // honestly rather than filing them under whatever is nearest.
    expect(flavourFamily('quantum')).toBeNull();
    expect(flavourFamily('')).toBeNull();
  });
});

describe('originFamily', () => {
  it('groups producing countries by what they tend to taste like', () => {
    expect(originFamily('Ethiopia')).toBe('East Africa');
    expect(originFamily('kenya')).toBe('East Africa');
    expect(originFamily('Costa Rica')).toBe('Central America');
    expect(originFamily('Colombia')).toBe('Andean South America');
  });

  it('keeps Brazil to itself', () => {
    // Deliberate: a heavy nutty Brazilian natural says little about a bright
    // washed Colombian, so filing them together would manufacture evidence. A
    // family of one simply never matches anything else, which is correct.
    expect(originFamily('Brazil')).toBe('Brazil');
    expect(originFamily('Peru')).not.toBe('Brazil');
  });

  it('returns null for a country it does not recognise', () => {
    expect(originFamily('Atlantis')).toBeNull();
  });
});

describe('process scale', () => {
  it('is ordered by fruit and fermentation character', () => {
    expect(PROCESS_ORDER).toEqual(['washed', 'honey', 'natural', 'anaerobic']);
  });

  it('leaves off the methods that do not sit on that axis', () => {
    // Wet-hulling is heavy and earthy rather than more or less fruity, so
    // placing it on the scale would invent a relationship that is not there.
    expect(PROCESS_ORDER).not.toContain('wet-hulled');
    expect(PROCESS_ORDER).not.toContain('other');
  });

  it('discounts every step and covers the whole scale', () => {
    expect(PROCESS_NEIGHBOUR_DISCOUNT[0]).toBe(1);
    expect(PROCESS_NEIGHBOUR_DISCOUNT).toHaveLength(PROCESS_ORDER.length);
    for (let i = 1; i < PROCESS_NEIGHBOUR_DISCOUNT.length; i += 1) {
      expect(PROCESS_NEIGHBOUR_DISCOUNT[i]).toBeLessThan(PROCESS_NEIGHBOUR_DISCOUNT[i - 1]!);
    }
  });
});
