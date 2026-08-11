import { describe, expect, it } from 'vitest';

import { buildQueryLadder, rankHits, scoreMatch, tokenise } from './productSearch.js';

/**
 * The case these exist for: a ratings import carried "Holler Mtn.", and
 * Stumptown's store search requires every word to match, so the lookup returned
 * nothing at all. "Holler Mountain" and bare "Holler" both find the coffee —
 * verified against the live store.
 */

describe('tokenise', () => {
  it('expands abbreviations and drops punctuation', () => {
    expect(tokenise('Holler Mtn.')).toEqual(['holler', 'mountain']);
  });

  it('treats an ampersand as a droppable word', () => {
    expect(tokenise('Black & White')).toEqual(['black', 'white']);
  });

  it('leaves ambiguous abbreviations alone', () => {
    // "No. 9" is a name, not "Number 9"; "Co" may be Company or Colombia.
    expect(tokenise('No. 9')).toEqual(['no', '9']);
    expect(tokenise('Ritual Co')).toEqual(['ritual', 'co']);
  });
});

describe('buildQueryLadder', () => {
  it('tries the name as written before loosening it', () => {
    const ladder = buildQueryLadder('Holler Mtn.');

    expect(ladder[0]).toBe('Holler Mtn.');
    expect(ladder).toContain('holler mountain');
    expect(ladder).toContain('holler');
  });

  it('sheds packaging words before it sheds real ones', () => {
    const ladder = buildQueryLadder('Hair Bender Whole Bean Coffee');

    expect(ladder).toContain('hair bender');
    expect(ladder.indexOf('hair bender')).toBeLessThan(ladder.indexOf('hair'));
  });

  it('never loosens all the way to an empty query', () => {
    for (const query of buildQueryLadder('Coffee Blend')) {
      expect(query.trim()).not.toBe('');
    }
  });

  it('is bounded, because every rung costs a round-trip', () => {
    expect(buildQueryLadder('One Two Three Four Five Six Seven').length).toBeLessThanOrEqual(4);
  });

  it('does not repeat a query when loosening changes nothing', () => {
    const ladder = buildQueryLadder('Homestead');
    expect(new Set(ladder).size).toBe(ladder.length);
  });
});

describe('scoreMatch', () => {
  it('scores an exact match highest', () => {
    expect(scoreMatch('Holler Mtn.', 'Holler Mountain')).toBe(1);
  });

  it('still matches through the store dressing up its title', () => {
    const plain = scoreMatch('Holler Mtn.', 'Holler Mountain');
    const dressed = scoreMatch('Holler Mtn.', 'Ground Holler Mountain');

    expect(dressed).toBeGreaterThan(0.5);
    expect(dressed).toBeLessThan(plain);
  });

  it('gives an unrelated coffee from the same store nothing', () => {
    // Searching Stumptown for "Holler" really does return this alongside it.
    expect(scoreMatch('Holler Mtn.', 'Homestead')).toBe(0);
  });

  it('does not let a shared packaging word carry a match', () => {
    expect(scoreMatch('Holler Mtn. Blend', 'Founders Blend')).toBeLessThan(0.5);
  });
});

describe('rankHits', () => {
  const hit = (productTitle: string) => ({
    url: `https://example.com/${productTitle.replace(/\s+/g, '-').toLowerCase()}`,
    title: `${productTitle} — Stumptown`,
    snippet: '',
    productTitle,
  });

  it('puts the closest product first and discards the unrelated one', () => {
    const ranked = rankHits('Holler Mtn.', [
      hit('Homestead'),
      hit('Ground Holler Mountain'),
      hit('Holler Mountain'),
    ]);

    expect(ranked.map((h) => h.productTitle)).toEqual([
      'Holler Mountain',
      'Ground Holler Mountain',
    ]);
  });

  it('returns nothing rather than a wrong answer', () => {
    // Auto-enrichment takes the top result without asking, so a bad match here
    // would silently overwrite the coffee's details.
    expect(rankHits('Holler Mtn.', [hit('Homestead'), hit('Hair Bender')])).toEqual([]);
  });

  it('ignores the vendor suffix when scoring', () => {
    // Every product on a store shares the vendor name, so counting it would
    // hand a free match to coffees that have nothing else in common.
    expect(rankHits('Holler Mtn.', [hit('Homestead')])).toEqual([]);
  });
});
