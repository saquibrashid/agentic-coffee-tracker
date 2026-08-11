import { describe, expect, it } from 'vitest';
import { parsedBeanToUpdate } from './mapping';
import type { ParsedBean } from './index';

const empty: ParsedBean = {
  roaster: null,
  name: null,
  origins: [],
  process: null,
  roastLevel: null,
  tastingNotes: [],
  roastDate: null,
  varietals: [],
  elevationMeters: null,
  roasterDescription: null,
  confidence: 0,
};

describe('parsedBeanToUpdate', () => {
  it('omits every field the model could not resolve', () => {
    expect(parsedBeanToUpdate(empty)).toEqual({ confidence: 0 });
  });

  describe('roast level inference', () => {
    it('derives the roast from the name when the model resolved none', () => {
      // The parse prompt says "do not guess", so a product name that states the
      // roast still comes back as null.
      const update = parsedBeanToUpdate({ ...empty, name: 'French Roast' });

      expect(update.roastLevel).toBe('dark');
    });

    it('derives the roast from the roaster description', () => {
      const update = parsedBeanToUpdate({
        ...empty,
        name: 'Southpaw',
        roasterDescription: 'Taken to a full city, just shy of second crack.',
      });

      expect(update.roastLevel).toBe('medium-dark');
    });

    it('prefers what the model resolved over anything inferable', () => {
      const update = parsedBeanToUpdate({
        ...empty,
        name: 'French Roast',
        roastLevel: 'light',
      });

      expect(update.roastLevel).toBe('light');
    });

    it('leaves the roast unset rather than reading it out of flavour words', () => {
      const update = parsedBeanToUpdate({
        ...empty,
        name: 'Geometry',
        tastingNotes: ['dark chocolate', 'light caramel'],
        roasterDescription: 'A syrupy body with a dark, jammy finish.',
      });

      expect(update.roastLevel).toBeUndefined();
    });

    it('respects a negated mention', () => {
      const update = parsedBeanToUpdate({
        ...empty,
        name: 'Southpaw',
        roasterDescription: 'None of the bitterness of a French roast.',
      });

      expect(update.roastLevel).toBeUndefined();
    });
  });

  it('maps resolved scalars and lists', () => {
    const update = parsedBeanToUpdate({
      ...empty,
      roaster: 'Onyx',
      name: 'Geometry',
      process: 'natural',
      roastLevel: 'light',
      tastingNotes: ['peach'],
      varietals: ['Heirloom'],
      roastDate: '2026-01-04',
      roasterDescription: 'Bright.',
      confidence: 0.8,
    });

    expect(update).toMatchObject({
      roaster: 'Onyx',
      name: 'Geometry',
      process: 'natural',
      roastLevel: 'light',
      tastingNotes: ['peach'],
      varietals: ['Heirloom'],
      roastDate: '2026-01-04',
      roasterDescription: 'Bright.',
      confidence: 0.8,
    });
  });

  it('drops origins with no country, since country is required locally', () => {
    const update = parsedBeanToUpdate({
      ...empty,
      origins: [
        { country: null, region: 'Guji', farm: null, producer: null, percentage: null },
        { country: 'Kenya', region: 'Nyeri', farm: null, producer: null, percentage: 40 },
      ],
    });
    expect(update.origins).toEqual([{ country: 'Kenya', region: 'Nyeri', percentage: 40 }]);
  });

  it('omits origins entirely when none survive', () => {
    const update = parsedBeanToUpdate({
      ...empty,
      origins: [{ country: null, region: null, farm: null, producer: null, percentage: null }],
    });
    expect(update.origins).toBeUndefined();
  });

  it('keeps a half-known elevation range but drops an empty one', () => {
    expect(
      parsedBeanToUpdate({ ...empty, elevationMeters: { min: 1800, max: null } }),
    ).toMatchObject({ elevationMeters: { min: 1800 } });
    expect(
      parsedBeanToUpdate({ ...empty, elevationMeters: { min: null, max: null } }).elevationMeters,
    ).toBeUndefined();
  });
});
