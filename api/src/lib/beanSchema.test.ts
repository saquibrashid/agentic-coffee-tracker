import { describe, expect, it } from 'vitest';
import {
  CAFFEINE_VALUES,
  MAX_PLAUSIBLE_ORIGINS,
  PARSED_BEAN_SCHEMA,
  PROCESS_VALUES,
  REQUIRED_BEAN_KEYS,
  ROAST_LEVEL_VALUES,
  mockParsedBean,
  normalizeParsedBean,
  validateParsedBean,
} from './beanSchema';

const valid = {
  roaster: 'Onyx',
  name: 'Geometry',
  origins: [{ country: 'Ethiopia', region: 'Guji', farm: null, producer: null, percentage: 60 }],
  process: 'washed',
  roastLevel: 'medium-light',
  caffeine: null,
  tastingNotes: ['peach', 'jasmine'],
  roastDate: '2026-01-04',
  varietals: ['Heirloom'],
  elevationMeters: { min: 1800, max: 2100 },
  roasterDescription: 'A bright, floral cup.',
  confidence: 0.87,
};

describe('validateParsedBean', () => {
  it('accepts a fully populated, spec-shaped object', () => {
    const result = validateParsedBean(valid);
    expect(result.valid).toBe(true);
  });

  it('accepts the mock response so mock mode never 422s', () => {
    const result = validateParsedBean(mockParsedBean('SOME OCR TEXT'));
    expect(result).toEqual({ valid: true, value: mockParsedBean('SOME OCR TEXT') });
  });

  it('fills omitted keys with null/[] rather than failing', () => {
    const result = validateParsedBean({ roaster: 'Onyx', confidence: 0.5 });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.name).toBeNull();
    expect(result.value.tastingNotes).toEqual([]);
    expect(result.value.origins).toEqual([]);
    expect(result.value.elevationMeters).toBeNull();
  });

  it('defaults confidence to 0 when the model omits it', () => {
    const result = validateParsedBean({});
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.confidence).toBe(0);
  });

  it('rejects a non-object payload', () => {
    expect(validateParsedBean('not json').valid).toBe(false);
    expect(validateParsedBean(undefined).valid).toBe(false);
    expect(validateParsedBean([]).valid).toBe(false);
  });

  it('rejects unknown properties', () => {
    const result = validateParsedBean({ ...valid, hallucinated: 'yes' });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.join(' ')).toContain('hallucinated');
  });

  it('rejects out-of-enum process and roastLevel values', () => {
    const result = validateParsedBean({ ...valid, process: 'sun-dried', roastLevel: 'extra-dark' });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors).toHaveLength(2);
  });

  it('rejects an out-of-enum caffeine value', () => {
    expect(validateParsedBean({ ...valid, caffeine: 'extra-strong' }).valid).toBe(false);
    for (const value of CAFFEINE_VALUES) {
      expect(validateParsedBean({ ...valid, caffeine: value }).valid).toBe(true);
    }
  });

  it('has no "unknown" caffeine value for the model to reach for', () => {
    // The model answers null when it cannot tell; "unknown" is the client's
    // word for the same state. Offering both would let the same absence arrive
    // two different ways and split every downstream comparison.
    expect(CAFFEINE_VALUES).not.toContain('unknown');
    expect(validateParsedBean({ ...valid, caffeine: 'unknown' }).valid).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    expect(validateParsedBean({ ...valid, confidence: 1.4 }).valid).toBe(false);
    expect(validateParsedBean({ ...valid, confidence: -0.1 }).valid).toBe(false);
    expect(validateParsedBean({ ...valid, confidence: 'high' }).valid).toBe(false);
  });

  it('rejects wrong types in arrays', () => {
    const result = validateParsedBean({ ...valid, tastingNotes: ['peach', 42] });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors[0]).toContain('/tastingNotes/1');
  });

  it('rejects malformed origins entries', () => {
    const result = validateParsedBean({ ...valid, origins: [{ country: 12 }] });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.join(' ')).toContain('/origins/0/country');
  });

  it('rejects a malformed elevation range', () => {
    const result = validateParsedBean({ ...valid, elevationMeters: { min: 'low', max: 2000 } });
    expect(result.valid).toBe(false);
  });

  it('reports every problem at once', () => {
    const result = validateParsedBean({ ...valid, roaster: 5, name: 5, confidence: 9 });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

/*
 * A coffee added from a Cometeer "build your own box" page came back with some
 * fifty origins: the page describes forty coffees, the prompt says the text is
 * about one, and merging is the only reading that allows. Nothing structural in
 * the page gives it away — it carries one schema.org Product block, and that
 * block names the box rather than any coffee — so the count of origins is the
 * cheapest evidence available that the input was never about a single coffee.
 */
describe('implausible origin counts', () => {
  const origin = (country: string) => ({
    country,
    region: null,
    farm: null,
    producer: null,
    percentage: null,
  });
  const origins = (n: number) => Array.from({ length: n }, (_, i) => origin(`Country ${i}`));

  it('rejects a coffee with more origins than any blend has', () => {
    const result = validateParsedBean({ ...valid, origins: origins(50) });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.join(' ')).toContain('more than one coffee');
  });

  it('still accepts a large but real blend', () => {
    // Holiday blends of five or six components are sold; the ceiling exists to
    // catch merged text, not to legislate what a blend may contain.
    const result = validateParsedBean({ ...valid, origins: origins(MAX_PLAUSIBLE_ORIGINS) });
    expect(result.valid).toBe(true);
  });

  it('rejects one past the ceiling, so the boundary is where it claims to be', () => {
    expect(
      validateParsedBean({ ...valid, origins: origins(MAX_PLAUSIBLE_ORIGINS + 1) }).valid,
    ).toBe(false);
  });

  it('rejects the whole result rather than trimming the list', () => {
    // Text that merged forty coffees merged their names and notes too. Trimming
    // to six would keep all of that and make it look deliberate.
    const result = validateParsedBean({
      ...valid,
      roaster: 'Cometeer',
      name: 'Build Your Own Box',
      tastingNotes: ['incredible coffee'],
      origins: origins(40),
    });
    expect(result.valid).toBe(false);
  });

  it('does not report the merged entries individually', () => {
    // Fifty per-origin complaints would bury the one fact that matters, and the
    // entries are not individually malformed — there are simply too many.
    const result = validateParsedBean({ ...valid, origins: origins(50) });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors).toHaveLength(1);
  });
});

describe('normalizeParsedBean', () => {
  it('leaves non-objects untouched for the validator to reject', () => {
    expect(normalizeParsedBean('nope')).toBe('nope');
  });

  it('backfills missing origin keys', () => {
    const out = normalizeParsedBean({ origins: [{ country: 'Kenya' }] }) as {
      origins: Record<string, unknown>[];
    };
    expect(out.origins[0]).toEqual({
      country: 'Kenya',
      region: null,
      farm: null,
      producer: null,
      percentage: null,
    });
  });
});

describe('PARSED_BEAN_SCHEMA', () => {
  it('stays in sync with the validator required keys', () => {
    expect(PARSED_BEAN_SCHEMA.required).toEqual([...REQUIRED_BEAN_KEYS]);
    expect(Object.keys(PARSED_BEAN_SCHEMA.properties)).toEqual([...REQUIRED_BEAN_KEYS]);
  });

  it('declares the same enums the validator enforces', () => {
    expect(PARSED_BEAN_SCHEMA.properties.process.enum).toEqual([...PROCESS_VALUES, null]);
    expect(PARSED_BEAN_SCHEMA.properties.roastLevel.enum).toEqual([...ROAST_LEVEL_VALUES, null]);
    expect(PARSED_BEAN_SCHEMA.properties.caffeine.enum).toEqual([...CAFFEINE_VALUES, null]);
  });

  it('forbids extra properties so structured outputs stay strict', () => {
    expect(PARSED_BEAN_SCHEMA.additionalProperties).toBe(false);
  });

  /*
   * The schema is the only per-field instruction the model gets. A pasted
   * "About" paragraph came back with `roasterDescription: null` because the
   * field was declared as a bare nullable string and nothing said what belongs
   * in it — the type alone leaves the model to guess from the name.
   */
  it('tells the model what the free-text fields are for', () => {
    expect(PARSED_BEAN_SCHEMA.properties.roasterDescription.description).toMatch(/prose|story/i);
    expect(PARSED_BEAN_SCHEMA.properties.tastingNotes.description).toBeTruthy();
    expect(PARSED_BEAN_SCHEMA.properties.varietals.description).toBeTruthy();
  });
});
