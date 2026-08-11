import { describe, expect, it } from 'vitest';

import { inferRoastFromText, inferRoastLevel } from './inferRoast';

describe('inferRoastFromText', () => {
  describe('modifier before the word', () => {
    it.each([
      ['A rich dark roast for espresso', 'dark'],
      ['Light roast, washed', 'light'],
      ['Our medium roast house blend', 'medium'],
      ['A medium-dark roast with body', 'medium-dark'],
      ['medium light roast', 'medium-light'],
      ['This coffee is dark roasted to order', 'dark'],
      ['light roasting brings out the florals', 'light'],
    ])('reads %j as %s', (text, level) => {
      expect(inferRoastFromText(text)?.level).toBe(level);
    });
  });

  describe('modifier after the word', () => {
    it.each([
      ['Roast: dark', 'dark'],
      ['Roast level: medium-dark', 'medium-dark'],
      ['ROAST LEVEL — LIGHT', 'light'],
      ['Roast profile: medium', 'medium'],
      ['Roast style: French', 'dark'],
    ])('reads %j as %s', (text, level) => {
      expect(inferRoastFromText(text)?.level).toBe(level);
    });
  });

  describe('traditional degree names', () => {
    it.each([
      ['French Roast', 'dark'],
      ['Italian Roast', 'dark'],
      ['Vienna Roast', 'dark'],
      ['Cinnamon roast', 'light'],
      ['Blonde Roast', 'light'],
      ['Full City', 'medium-dark'],
      ['Full City+', 'medium-dark'],
      ['City+', 'medium'],
      ['Roasted to City+', 'medium'],
    ])('reads %j as %s', (text, level) => {
      expect(inferRoastFromText(text)?.level).toBe(level);
    });
  });

  /**
   * The reason this module keys on roast vocabulary rather than flavour words.
   * Every string here would be a wrong answer written into the field the
   * recommendation engine reasons over.
   */
  describe('does not mistake flavour and body descriptors for a roast', () => {
    it.each([
      'Dark chocolate, cherry, almond',
      'Notes of dark berry and molasses',
      'Light body, bright acidity',
      'A light and delicate cup',
      'Deep caramel with a heavy body',
      'Smoky, bold and intense',
      'Milk chocolate and toasted nuts',
      'Medium body, medium acidity',
    ])('ignores %j', (text) => {
      expect(inferRoastFromText(text)).toBeNull();
    });

    it('ignores a city that is part of a place name', () => {
      expect(inferRoastFromText('Kansas City Coffee Roasters')).toBeNull();
      expect(inferRoastFromText('Queen City Collective')).toBeNull();
    });

    it('ignores espresso, which names a brew method and not a roast', () => {
      // Specialty roasters routinely serve espresso light, so reading a roast
      // level out of this would mislabel exactly the coffees it guessed on.
      expect(inferRoastFromText('Espresso Roast')).toBeNull();
      expect(inferRoastFromText('Our espresso blend')).toBeNull();
    });

    /** Ordinary roaster copy that names a roast the coffee explicitly is not. */
    it.each([
      'Not your typical dark roast',
      'This is not a dark roast',
      'None of the bitterness of a French roast',
      'Unlike a dark roast, this keeps its acidity',
      'Bold flavour without the dark roast bite',
      'We stop well short of a full city',
    ])('does not assert a roast that is being denied: %j', (text) => {
      expect(inferRoastFromText(text)).toBeNull();
    });

    it('still matches a genuine mention later in the text', () => {
      // The negation window is deliberately short, so a "not" in an earlier
      // sentence must not suppress a real statement in a later one.
      expect(inferRoastFromText('We do not cut corners. Roast level: dark.')?.level).toBe('dark');
    });
  });

  describe('specificity', () => {
    it('prefers the compound modifier over its parts', () => {
      // "medium dark roast" must not resolve to 'dark' on the trailing word,
      // nor to 'medium' on the leading one.
      expect(inferRoastFromText('medium dark roast')?.level).toBe('medium-dark');
      expect(inferRoastFromText('a medium-light roast')?.level).toBe('medium-light');
    });

    it('prefers full city over city', () => {
      expect(inferRoastFromText('Full City+ roast')?.level).toBe('medium-dark');
    });
  });

  describe('normalisation', () => {
    it.each([
      'medium-dark roast',
      'medium–dark roast',
      'MEDIUM DARK ROAST',
      '(medium dark roast)',
      'roast:medium dark',
    ])('handles %j', (text) => {
      expect(inferRoastFromText(text)?.level).toBe('medium-dark');
    });

    it('returns null for empty and whitespace-only text', () => {
      expect(inferRoastFromText('')).toBeNull();
      expect(inferRoastFromText('   ')).toBeNull();
    });
  });

  it('reports the phrase it matched on', () => {
    // Callers surface this so an inferred value can be explained rather than
    // appearing as an unattributed fact about the coffee.
    expect(inferRoastFromText('A classic French Roast, bold')?.evidence).toBe('french roast');
  });
});

describe('inferRoastLevel', () => {
  it('reads the name first', () => {
    expect(
      inferRoastLevel({
        name: 'French Roast',
        roasterDescription: 'A light and lively cup',
      })?.level,
    ).toBe('dark');
  });

  it('falls back to the description when the name says nothing', () => {
    expect(
      inferRoastLevel({
        name: 'Morning Blend',
        roasterDescription: 'We take this one to a full city, just shy of second crack.',
      })?.level,
    ).toBe('medium-dark');
  });

  it('falls back to tasting notes last', () => {
    expect(
      inferRoastLevel({
        name: 'Morning Blend',
        tastingNotes: ['dark roast', 'cocoa'],
      })?.level,
    ).toBe('dark');
  });

  it('does not infer from flavour notes alone', () => {
    expect(
      inferRoastLevel({
        name: 'Morning Blend',
        roasterDescription: 'Sweet and balanced.',
        tastingNotes: ['dark chocolate', 'toasted almond', 'light caramel'],
      }),
    ).toBeNull();
  });

  it('returns null when nothing is provided', () => {
    expect(inferRoastLevel({})).toBeNull();
    expect(inferRoastLevel({ name: '', tastingNotes: [] })).toBeNull();
  });
});
