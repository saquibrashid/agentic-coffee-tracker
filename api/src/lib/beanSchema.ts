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

/**
 * `unknown` is absent here, as it is for process and roast level: the model
 * says `null` when it cannot tell, and the client maps that to `'unknown'`.
 * Offering both would give the model two ways to spell the same answer.
 */
export const CAFFEINE_VALUES = ['caffeinated', 'decaf', 'half-caf'] as const;

/**
 * One coffee in the bag or several — a separate axis from `process`, and
 * deliberately not a value inside it.
 *
 * Counter Culture's "Fast Forward" is why: it is sold as a "Year-Round Blend"
 * and its page also states "Process: Washed". Both are true, so a `blend`
 * option inside `PROCESS_VALUES` would force the model to throw one away.
 *
 * `unknown` is absent for the same reason as above — the model says `null`.
 * Silence is common and genuine here: plenty of pages say neither word.
 */
export const COMPOSITION_VALUES = ['blend', 'single-origin'] as const;

/**
 * The form the coffee arrives in — not who sold it.
 *
 * This began life as a free-text `vendor` on the reading that a Cometeer box is
 * coffee sold by Cometeer. It is not: Cometeer flash-freezes other roasters'
 * brewed coffee into pucks, so the box is Counter Culture's coffee in a
 * different form. The shop was a grocery store, and which shop a coffee came
 * from says nothing about the coffee.
 *
 * A closed enum rather than a string is the point. Free text invites a retailer
 * straight back into the field the moment the model reads a receipt; an enum
 * gives "Sprouts" nowhere to land. `process` and `roastLevel` are shaped the
 * same way for the same reason.
 */
export const FORMAT_VALUES = [
  'whole-bean',
  'ground',
  'cometeer',
  'nespresso',
  'k-cup',
  'instant',
] as const;

export type ProcessValue = (typeof PROCESS_VALUES)[number];
export type RoastLevelValue = (typeof ROAST_LEVEL_VALUES)[number];
export type CaffeineValue = (typeof CAFFEINE_VALUES)[number];
export type CompositionValue = (typeof COMPOSITION_VALUES)[number];
export type FormatValue = (typeof FORMAT_VALUES)[number];

/**
 * More origins than any one coffee has, which makes it a signal about the text.
 *
 * A coffee added from a Cometeer "build your own box" page came back with some
 * fifty origins. Nothing had gone wrong in the model's own terms: it was handed
 * a page describing forty different coffees and told the text was about one, so
 * it did the only thing that instruction allows and merged them.
 *
 * Blends are the reason this is a ceiling rather than a rule against more than
 * one origin — a holiday blend of five or six components is a real product. But
 * a coffee with more origins than that is not a recipe, it is two coffees'
 * worth of text that were never separated. The count is the cheapest reliable
 * evidence that the input was not about a single coffee.
 *
 * The whole result is rejected rather than the list trimmed. Text that merged
 * forty coffees also merged their names, notes and descriptions, so the origins
 * are the symptom and not the disease — the observed result carried a site
 * tagline as the roaster's description and "incredible coffee" as a tasting
 * note. Trimming to six would leave all of that in place and make it look
 * deliberate; fifty origins is at least visibly absurd, and six wrong ones are
 * not. Rejecting sends the caller down the path it already has for a model
 * answer it cannot use: the bean is flagged for review with the raw text kept.
 */
export const MAX_PLAUSIBLE_ORIGINS = 6;

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
  format: FormatValue | null;
  caffeine: CaffeineValue | null;
  composition: CompositionValue | null;
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
  'format',
  'caffeine',
  'composition',
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
    format: {
      type: ['string', 'null'],
      enum: [...FORMAT_VALUES, null],
      description:
        'The form the coffee arrives in, when the text says: "cometeer" for Cometeer\'s flash-frozen pucks, "nespresso" or "k-cup" for those capsules, "ground" for pre-ground bags, "instant", "whole-bean" when stated outright. This is NOT who sold it: a Cometeer box of Counter Culture coffee still has Counter Culture as its roaster, and a grocery store or online marketplace is never a format. Whole beans are the ordinary case and are assumed downstream, so return null when the text does not say.',
    },
    caffeine: {
      type: ['string', 'null'],
      enum: [...CAFFEINE_VALUES, null],
      description:
        'Only when the text says so — "decaf", "decaffeinated", "Swiss Water", "EA/sugarcane process", or "half-caf". Most coffee is caffeinated and does not advertise it, so silence means null, NOT "caffeinated". Do not infer decaf from a name that merely sounds like an evening drink.',
    },
    composition: {
      type: ['string', 'null'],
      enum: [...COMPOSITION_VALUES, null],
      description:
        'Whether the bag holds several coffees or one. "blend" when the text calls it a blend or names multiple component lots; "single-origin" when it says single origin (however spelled) or presents one farm/lot as the whole coffee. This is independent of process — a blend can still state a process, so record both. Return null when the text does not say; do not guess from the name or from how many origins are listed.',
    },
    tastingNotes: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Flavour descriptors the text gives for the cup, e.g. "floral", "dark chocolate". Individual words or short phrases, not a sentence.',
    },
    roastDate: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    varietals: {
      type: 'array',
      items: { type: 'string' },
      description: 'Coffee plant varieties, e.g. "Heirloom", "Caturra", "Gesha".',
    },
    elevationMeters: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['min', 'max'],
      properties: {
        min: { type: ['number', 'null'] },
        max: { type: ['number', 'null'] },
      },
    },
    roasterDescription: {
      type: ['string', 'null'],
      description:
        "The roaster's own prose about this coffee — its story, cooperative or farm, processing, or what it tastes like. Copy it from the text; do not write your own. Exclude shipping, pricing, subscription and other boilerplate that is not about the coffee.",
    },
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
    'format',
    'caffeine',
    'composition',
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
  if (value.length > MAX_PLAUSIBLE_ORIGINS) {
    // Not a schema violation — the shape is fine. It is the count that says the
    // text described several coffees, and the caller should treat the answer as
    // unusable rather than record a blend nobody sells.
    errors.push(
      `/origins has ${value.length} entries, more than the ${MAX_PLAUSIBLE_ORIGINS} a single ` +
        'coffee can plausibly have; the text likely described more than one coffee',
    );
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
  checkEnum(candidate['format'], FORMAT_VALUES, '/format', errors);
  checkEnum(candidate['caffeine'], CAFFEINE_VALUES, '/caffeine', errors);
  checkEnum(candidate['composition'], COMPOSITION_VALUES, '/composition', errors);
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
    format: null,
    caffeine: 'caffeinated',
    composition: 'blend',
    tastingNotes: ['chocolate', 'caramel', 'sweet'],
    roastDate: null,
    varietals: [],
    elevationMeters: null,
    roasterDescription: ocrText.slice(0, 200) || null,
    confidence: 0.92,
  };
}
