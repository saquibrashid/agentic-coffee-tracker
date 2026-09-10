import { describe, expect, it } from 'vitest';

import { uniqueTastingNotes } from './notes';

describe('uniqueTastingNotes', () => {
  it('counts a note listed twice as one note', () => {
    expect(uniqueTastingNotes(['Chocolate', 'Chocolate'])).toEqual(['Chocolate']);
  });

  it('matches case-insensitively but keeps the spelling first written', () => {
    expect(uniqueTastingNotes(['Chocolate', 'chocolate', 'CHOCOLATE'])).toEqual(['Chocolate']);
  });

  it('treats a doubled space as the same note typed differently', () => {
    expect(uniqueTastingNotes(['dark  chocolate', 'dark chocolate'])).toEqual(['dark  chocolate']);
  });

  it('trims, so a stray space cannot open a second bucket', () => {
    expect(uniqueTastingNotes([' Plum ', 'Plum'])).toEqual(['Plum']);
  });

  it('keeps genuinely different notes, in the order listed', () => {
    expect(uniqueTastingNotes(['Plum', 'Walnut', 'Plum'])).toEqual(['Plum', 'Walnut']);
  });

  it('does not conflate two notes that merely share a word', () => {
    expect(uniqueTastingNotes(['Chocolate', 'Dark chocolate'])).toEqual([
      'Chocolate',
      'Dark chocolate',
    ]);
  });

  it('drops blanks rather than counting an empty bucket', () => {
    expect(uniqueTastingNotes(['   ', 'Plum'])).toEqual(['Plum']);
  });

  it('handles a coffee with no notes recorded', () => {
    expect(uniqueTastingNotes(undefined)).toEqual([]);
  });
});
