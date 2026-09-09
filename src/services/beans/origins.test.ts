import { describe, expect, it } from 'vitest';

import { dedupeOrigins, formatOriginList, uniqueOriginCountries } from './origins';

describe('uniqueOriginCountries', () => {
  it('counts a country once however many lots the blend lists', () => {
    expect(
      uniqueOriginCountries([
        { country: 'Guatemala', farm: 'Manos Campesinas' },
        { country: 'Guatemala', farm: 'Finca La Hermosa' },
      ]),
    ).toEqual(['Guatemala']);
  });

  it('keeps genuinely different countries, in the order listed', () => {
    expect(
      uniqueOriginCountries([{ country: 'Peru' }, { country: 'Ethiopia' }, { country: 'Peru' }]),
    ).toEqual(['Peru', 'Ethiopia']);
  });

  it('matches case-insensitively but returns the spelling first used', () => {
    expect(uniqueOriginCountries([{ country: 'Guatemala' }, { country: 'GUATEMALA' }])).toEqual([
      'Guatemala',
    ]);
  });

  it('trims, so a stray space cannot open a second bucket', () => {
    expect(uniqueOriginCountries([{ country: ' Guatemala ' }, { country: 'Guatemala' }])).toEqual([
      'Guatemala',
    ]);
  });

  it('drops blank countries rather than counting an empty bucket', () => {
    expect(uniqueOriginCountries([{ country: '   ' }, { country: 'Kenya' }])).toEqual(['Kenya']);
  });

  it('handles a coffee with no origins recorded', () => {
    expect(uniqueOriginCountries(undefined)).toEqual([]);
  });
});

describe('dedupeOrigins', () => {
  it('collapses entries that agree in every field', () => {
    expect(dedupeOrigins([{ country: 'Guatemala' }, { country: 'Guatemala' }])).toEqual([
      { country: 'Guatemala' },
    ]);
  });

  it('keeps two lots that differ by farm, which are not the same origin', () => {
    const origins = [
      { country: 'Guatemala', farm: 'Manos Campesinas' },
      { country: 'Guatemala', farm: 'Finca La Hermosa' },
    ];
    expect(dedupeOrigins(origins)).toHaveLength(2);
  });

  it('keeps two lots that differ only by percentage', () => {
    const origins = [
      { country: 'Brazil', percentage: 60 },
      { country: 'Brazil', percentage: 40 },
    ];
    expect(dedupeOrigins(origins)).toHaveLength(2);
  });
});

describe('formatOriginList', () => {
  it('shows country and region, leaving farm out of a readable line', () => {
    expect(formatOriginList([{ country: 'Colombia', region: 'Huila', farm: 'El Mirador' }])).toBe(
      'Colombia (Huila)',
    );
  });

  it('names the farm only when two entries would otherwise read the same', () => {
    expect(
      formatOriginList([
        { country: 'Guatemala', farm: 'Manos Campesinas' },
        { country: 'Guatemala', farm: 'Finca La Hermosa' },
      ]),
    ).toBe('Guatemala (Manos Campesinas), Guatemala (Finca La Hermosa)');
  });

  it('falls back to the producer when there is no farm to tell them apart', () => {
    expect(
      formatOriginList([
        { country: 'Kenya', producer: 'Gichathaini' },
        { country: 'Kenya', producer: 'Kagumoini' },
      ]),
    ).toBe('Kenya (Gichathaini), Kenya (Kagumoini)');
  });

  it('adds the farm alongside the region rather than in a second bracket', () => {
    expect(
      formatOriginList([
        { country: 'Guatemala', region: 'Huehuetenango', farm: 'A' },
        { country: 'Guatemala', region: 'Huehuetenango', farm: 'B' },
      ]),
    ).toBe('Guatemala (Huehuetenango · A), Guatemala (Huehuetenango · B)');
  });

  it('leaves a percentage-distinguished blend alone, since it already reads distinctly', () => {
    expect(
      formatOriginList([
        { country: 'Brazil', percentage: 60 },
        { country: 'Colombia', percentage: 40 },
      ]),
    ).toBe('Brazil 60%, Colombia 40%');
  });

  it('collapses an exact repeat instead of disambiguating it', () => {
    expect(formatOriginList([{ country: 'Guatemala' }, { country: 'Guatemala' }])).toBe(
      'Guatemala',
    );
  });

  it('says nothing when there is nothing to say', () => {
    expect(formatOriginList([])).toBe('');
  });
});
