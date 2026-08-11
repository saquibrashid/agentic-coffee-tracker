/**
 * Canonical LLM output contract for `/api/parse`.
 *
 * Mirrors `specs/data-model.md` § "LLM Output Contract". It is used for two things:
 *  1. as the `json_schema` sent to Azure OpenAI structured outputs, and
 *  2. as the server-side validation gate, so malformed model output never reaches
 *     the client dressed up as trustworthy data.
 *
 * The validator is hand-written rather than schema-driven (no ajv) to keep the
 * Function App dependency-free and cold-start friendly. `PARSED_BEAN_SCHEMA` and
 * `validateParsedBean` must be kept in sync — `beanSchema.test.ts` asserts that.
 */

export const PROCESS_VALUES = [
  'washed',
  'natural',
  'honey',
  'anaerobic',
  'wet-hulled',
  'other',
] as const;

export const ROAST_LEVEL_VALUES = [
  'light',
  'medium-light',
  'medium',
  'medium-dark',
  'dark',
] as const;

export type ProcessValue = (typeof PROCESS_VALUES)[number];
export type RoastLevelValue = (typeof ROAST_LEVEL_VALUES)[number];

export interface ParsedOrigin {
  country: string | null;
  region: string | null;
  farm: string | null;
  producer: string | null;
  percentage: number | null;
}

export interface ParsedBean {
  roaster: string | null;
  name: string | null;
  origins: ParsedOrigin[];
  process: ProcessValue | null;
  roastLevel: RoastLevelValue | null;
  tastingNotes: string[];
  roastDate: string | null;
  varietals: string[];
  elevationMeters: { min: number | null; max: number | null } | null;
  roasterDescription: string | null;
  confidence: number;
}

/** Keys that must be present on a valid parse result, in spec order. */
export const REQUIRED_BEAN_KEYS = [
  'roaster',
  'name',
  'origins',
  'process',
  'roastLevel',
  'tastingNotes',
  'roastDate',
  'varietals',
  'elevationMeters',
  'roasterDescription',
  'confidence',
] as const;

export const REQUIRED_ORIGIN_KEYS = [
  'country',
  'region',
  'farm',
  'producer',
  'percentage',
] as const;

/** JSON Schema sent to Azure OpenAI structured outputs. */
export const PARSED_BEAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...REQUIRED_BEAN_KEYS],
  properties: {
    roaster: { type: ['string', 'null'] },
    name: { type: ['string', 'null'] },
    origins: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [...REQUIRED_ORIGIN_KEYS],
        properties: {
          country: { type: ['string', 'null'] },
          region: { type: ['string', 'null'] },
          farm: { type: ['string', 'null'] },
          producer: { type: ['string', 'null'] },
          percentage: { type: ['number', 'null'] },
        },
      },
    },
    process: { type: ['string', 'null'], enum: [...PROCESS_VALUES, null] },
    roastLevel: { type: ['string', 'null'], enum: [...ROAST_LEVEL_VALUES, null] },
    tastingNotes: { type: 'array', items: { type: 'string' } },
    roastDate: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    varietals: { type: 'array', items: { type: 'string' } },
    elevationMeters: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['min', 'max'],
      properties: {
        min: { type: ['number', 'null'] },
        max: { type: ['number', 'null'] },
      },
    },
    roasterDescription: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export type ValidationResult =
  { valid: true; value: ParsedBean } | { valid: false; errors: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Fills in required keys the model omitted, so a merely *incomplete* response is
 * treated as "nothing known" rather than a hard failure. Present-but-wrong-typed
 * values are left untouched so validation still rejects them.
 */
export function normalizeParsedBean(input: unknown): unknown {
  if (!isPlainObject(input)) return input;
  const obj: Record<string, unknown> = { ...input };

  for (const key of [
    'roaster',
    'name',
    'process',
    'roastLevel',
    'roastDate',
    'roasterDescription',
  ]) {
    if (obj[key] === undefined) obj[key] = null;
  }
  for (const key of ['origins', 'tastingNotes', 'varietals']) {
    if (obj[key] === undefined) obj[key] = [];
  }
  if (obj['elevationMeters'] === undefined) obj['elevationMeters'] = null;
  if (obj['confidence'] === undefined) obj['confidence'] = 0;

  const origins = obj['origins'];
  if (Array.isArray(origins)) {
    obj['origins'] = origins.map((origin: unknown) => {
      if (!isPlainObject(origin)) return origin;
      const next: Record<string, unknown> = { ...origin };
      for (const key of REQUIRED_ORIGIN_KEYS) {
        if (next[key] === undefined) next[key] = null;
      }
      return next;
    });
  }

  return obj;
}

function checkNullableString(value: unknown, path: string, errors: string[]): void {
  if (value !== null && typeof value !== 'string') {
    errors.push(`${path} must be a string or null`);
  }
}

function checkNullableNumber(value: unknown, path: string, errors: string[]): void {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    errors.push(`${path} must be a finite number or null`);
  }
}

function checkStringArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array of strings`);
    return;
  }
  value.forEach((item: unknown, i) => {
    if (typeof item !== 'string') errors.push(`${path}/${i} must be a string`);
  });
}

function checkEnum(
  value: unknown,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  if (value === null) return;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    errors.push(`${path} must be null or one of: ${allowed.join(', ')}`);
  }
}

function checkOrigins(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push('/origins must be an array');
    return;
  }
  value.forEach((origin: unknown, i) => {
    const path = `/origins/${i}`;
    if (!isPlainObject(origin)) {
      errors.push(`${path} must be an object`);
      return;
    }
    for (const key of REQUIRED_ORIGIN_KEYS) {
      if (!(key in origin)) errors.push(`${path} is missing required property '${key}'`);
    }
    checkNullableString(origin['country'], `${path}/country`, errors);
    checkNullableString(origin['region'], `${path}/region`, errors);
    checkNullableString(origin['farm'], `${path}/farm`, errors);
    checkNullableString(origin['producer'], `${path}/producer`, errors);
    checkNullableNumber(origin['percentage'], `${path}/percentage`, errors);
  });
}

function checkElevation(value: unknown, errors: string[]): void {
  if (value === null) return;
  if (!isPlainObject(value)) {
    errors.push('/elevationMeters must be an object or null');
    return;
  }
  for (const key of ['min', 'max']) {
    if (!(key in value)) errors.push(`/elevationMeters is missing required property '${key}'`);
  }
  checkNullableNumber(value['min'], '/elevationMeters/min', errors);
  checkNullableNumber(value['max'], '/elevationMeters/max', errors);
}

/** Normalizes then validates model output against the canonical schema. */
export function validateParsedBean(input: unknown): ValidationResult {
  const candidate = normalizeParsedBean(input);
  const errors: string[] = [];

  if (!isPlainObject(candidate)) {
    return { valid: false, errors: ['root must be an object'] };
  }

  for (const key of REQUIRED_BEAN_KEYS) {
    if (!(key in candidate)) errors.push(`/ is missing required property '${key}'`);
  }

  const allowed = new Set<string>(REQUIRED_BEAN_KEYS);
  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) errors.push(`/${key} is not an allowed property`);
  }

  checkNullableString(candidate['roaster'], '/roaster', errors);
  checkNullableString(candidate['name'], '/name', errors);
  checkNullableString(candidate['roastDate'], '/roastDate', errors);
  checkNullableString(candidate['roasterDescription'], '/roasterDescription', errors);
  checkEnum(candidate['process'], PROCESS_VALUES, '/process', errors);
  checkEnum(candidate['roastLevel'], ROAST_LEVEL_VALUES, '/roastLevel', errors);
  checkStringArray(candidate['tastingNotes'], '/tastingNotes', errors);
  checkStringArray(candidate['varietals'], '/varietals', errors);
  checkOrigins(candidate['origins'], errors);
  checkElevation(candidate['elevationMeters'], errors);

  const confidence = candidate['confidence'];
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    errors.push('/confidence must be a number');
  } else if (confidence < 0 || confidence > 1) {
    errors.push('/confidence must be between 0 and 1');
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: candidate as unknown as ParsedBean };
}

/** Schema-shaped, deterministic response used when Azure OpenAI is not configured. */
export function mockParsedBean(ocrText: string): ParsedBean {
  return {
    roaster: 'Mock Roaster',
    name: 'Espresso Blend',
    origins: [{ country: 'Mockland', region: null, farm: null, producer: null, percentage: null }],
    process: 'washed',
    roastLevel: 'medium',
    tastingNotes: ['chocolate', 'caramel', 'sweet'],
    roastDate: null,
    varietals: [],
    elevationMeters: null,
    roasterDescription: ocrText.slice(0, 200) || null,
    confidence: 0.92,
  };
}
