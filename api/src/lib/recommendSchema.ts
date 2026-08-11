/**
 * Recommendation contract for `/api/recommend`.
 *
 * The client sends only an anonymous *summary* of taste preferences — never the
 * raw log, photos, or notes. The model must ground each suggestion in that
 * summary, and the server validates the response before returning it.
 */

export interface RankedSummaryItem {
  value: string;
  count: number;
  averageScore: number;
}

export interface PreferenceSummary {
  favoriteOrigins: RankedSummaryItem[];
  favoriteRoasters: RankedSummaryItem[];
  favoriteProcesses: RankedSummaryItem[];
  favoriteRoastLevels: RankedSummaryItem[];
  favoriteFlavors: RankedSummaryItem[];
  favoriteBrewTypes: RankedSummaryItem[];
  averageScore: number;
  totalRatings: number;
}

export interface Recommendation {
  title: string;
  /** Why this fits, phrased in terms of the user's own history. */
  rationale: string;
  /** The preference values this suggestion is grounded in. */
  basedOn: string[];
  origin: string | null;
  roastLevel: string | null;
  process: string | null;
  flavorNotes: string[];
}

export interface RecommendationSet {
  recommendations: Recommendation[];
}

export const RECOMMENDATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recommendations'],
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'rationale',
          'basedOn',
          'origin',
          'roastLevel',
          'process',
          'flavorNotes',
        ],
        properties: {
          title: { type: 'string' },
          rationale: { type: 'string' },
          basedOn: { type: 'array', items: { type: 'string' } },
          origin: { type: ['string', 'null'] },
          roastLevel: { type: ['string', 'null'] },
          process: { type: ['string', 'null'] },
          flavorNotes: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export type RecommendationValidation =
  { valid: true; value: RecommendationSet } | { valid: false; errors: string[] };

export function validateRecommendations(input: unknown): RecommendationValidation {
  const errors: string[] = [];
  if (!isPlainObject(input)) return { valid: false, errors: ['root must be an object'] };

  const list = input['recommendations'];
  if (!Array.isArray(list)) {
    return { valid: false, errors: ['/recommendations must be an array'] };
  }

  list.forEach((item: unknown, i) => {
    const path = `/recommendations/${i}`;
    if (!isPlainObject(item)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (typeof item['title'] !== 'string' || item['title'].trim() === '') {
      errors.push(`${path}/title must be a non-empty string`);
    }
    if (typeof item['rationale'] !== 'string' || item['rationale'].trim() === '') {
      errors.push(`${path}/rationale must be a non-empty string`);
    }
    // A suggestion with no grounding is exactly the hallucination we are guarding against.
    if (!isStringArray(item['basedOn']) || item['basedOn'].length === 0) {
      errors.push(`${path}/basedOn must list at least one preference it is grounded in`);
    }
    if (!isNullableString(item['origin'])) errors.push(`${path}/origin must be a string or null`);
    if (!isNullableString(item['roastLevel'])) {
      errors.push(`${path}/roastLevel must be a string or null`);
    }
    if (!isNullableString(item['process'])) errors.push(`${path}/process must be a string or null`);
    if (!isStringArray(item['flavorNotes'])) {
      errors.push(`${path}/flavorNotes must be an array of strings`);
    }
  });

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: { recommendations: list as Recommendation[] } };
}

function topValue(items: RankedSummaryItem[] | undefined): string | null {
  return items && items.length > 0 ? (items[0] as RankedSummaryItem).value : null;
}

/**
 * Deterministic recommendations used when Azure OpenAI is not configured. These
 * are genuinely derived from the summary — not lorem ipsum — so mock mode still
 * exercises realistic UI states.
 */
export function mockRecommendations(summary: PreferenceSummary): RecommendationSet {
  const origin = topValue(summary.favoriteOrigins);
  const roastLevel = topValue(summary.favoriteRoastLevels);
  const process = topValue(summary.favoriteProcesses);
  const flavor = topValue(summary.favoriteFlavors);
  const roaster = topValue(summary.favoriteRoasters);

  const recommendations: Recommendation[] = [];

  if (origin) {
    recommendations.push({
      title: `Another ${origin} single origin`,
      rationale: `${origin} coffees are your highest-rated origin so far.`,
      basedOn: [origin],
      origin,
      roastLevel,
      process,
      flavorNotes: flavor ? [flavor] : [],
    });
  }

  if (flavor) {
    recommendations.push({
      title: `Something else with ${flavor} notes`,
      rationale: `You consistently rate coffees with ${flavor} notes highly.`,
      basedOn: [flavor],
      origin: null,
      roastLevel,
      process: null,
      flavorNotes: [flavor],
    });
  }

  if (roaster) {
    recommendations.push({
      title: `A different roast from ${roaster}`,
      rationale: `${roaster} is your best-performing roaster.`,
      basedOn: [roaster],
      origin: null,
      roastLevel,
      process: null,
      flavorNotes: [],
    });
  }

  return { recommendations };
}
