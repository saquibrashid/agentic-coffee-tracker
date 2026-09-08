import { describe, expect, it } from 'vitest';
import { caffeineForNewBean, inferCaffeine } from './inferCaffeine';

describe('inferCaffeine', () => {
  it('reads decaf out of the product name', () => {
    // The parse prompt forbids guessing, so a bag that says "Decaf" only in
    // its name comes back null from the model. This is the gap that closes.
    expect(inferCaffeine({ name: 'Night Light Decaf' })).toEqual({
      level: 'decaf',
      evidence: 'decaf',
    });
  });

  it('recognises half-caf as its own answer', () => {
    expect(inferCaffeine({ name: 'Half-Caf House Blend' })?.level).toBe('half-caf');
    expect(inferCaffeine({ name: 'Half Caff Morning' })?.level).toBe('half-caf');
  });

  it('recognises a decaffeination method as a statement that it is decaf', () => {
    // Roasters routinely name the process instead of the word.
    expect(inferCaffeine({ name: 'Colombia Swiss Water' })?.level).toBe('decaf');
    expect(
      inferCaffeine({
        name: 'Colombia Huila',
        roasterDescription: 'Decaffeinated by the sugarcane EA method.',
      })?.level,
    ).toBe('decaf');
  });

  it('never answers "caffeinated" from silence', () => {
    // Ordinary coffee does not label itself. Reading an unmarked bag as
    // confirmed caffeinated would mark the whole library answered when none
    // of it has been checked.
    expect(inferCaffeine({ name: 'Southern Weather' })).toBeUndefined();
    expect(
      inferCaffeine({ name: 'Geometry', roasterDescription: 'A bright, floral coffee.' }),
    ).toBeUndefined();
    expect(inferCaffeine({})).toBeUndefined();
  });

  it('ignores a decaf mentioned in prose about a different coffee', () => {
    // "Also available as a decaf" and "unlike our decaf" both appear on pages
    // for fully caffeinated coffee. Matching them would label the wrong bean,
    // so bare decaf wording is only trusted in the name.
    expect(
      inferCaffeine({
        name: 'Southern Weather',
        roasterDescription: 'Also available as a decaf.',
      }),
    ).toBeUndefined();
    expect(
      inferCaffeine({
        name: 'Southern Weather',
        roasterDescription: 'Unlike our decaf, this one is built for espresso.',
      }),
    ).toBeUndefined();
  });

  it('does not match a fragment inside a longer word', () => {
    expect(inferCaffeine({ name: 'Decafeinado Supremo Blend' })?.level).toBe(undefined);
  });

  it('is case-insensitive', () => {
    expect(inferCaffeine({ name: 'DECAF ESPRESSO' })?.level).toBe('decaf');
  });
});

describe('caffeineForNewBean', () => {
  it('assumes caffeinated when the text says nothing', () => {
    // The distinction from `inferCaffeine`, which returns undefined here.
    expect(caffeineForNewBean({ name: 'Hair Bender' })).toBe('caffeinated');
  });

  it('assumes caffeinated when there is no text at all', () => {
    expect(caffeineForNewBean({})).toBe('caffeinated');
  });

  it('lets evidence beat the assumption', () => {
    expect(caffeineForNewBean({ name: 'Night Light Decaf' })).toBe('decaf');
  });

  it('lets a half-caf name beat the assumption', () => {
    expect(caffeineForNewBean({ name: 'Half-Caf House Blend' })).toBe('half-caf');
  });

  it('lets a decaffeination method in the description beat the assumption', () => {
    expect(
      caffeineForNewBean({
        name: 'Storyville Reserve',
        roasterDescription: 'Sugarcane EA, sweet and clean.',
      }),
    ).toBe('decaf');
  });
});
