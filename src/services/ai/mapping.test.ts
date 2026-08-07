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
