import { describe, expect, it } from 'vitest';
import {
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
