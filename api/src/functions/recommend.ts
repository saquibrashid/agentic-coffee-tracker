import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import {
  callResponses,
  getOpenAiConfig,
  parseJsonOutput,
  type OpenAiConfig,
} from '../lib/openai.js';
import {
  RECOMMENDATION_SCHEMA,
  mockRecommendations,
  validateRecommendations,
  type PreferenceSummary,
} from '../lib/recommendSchema.js';

interface RecommendRequest {
  preferences?: unknown;
  max?: unknown;
}

const RECOMMEND_SYSTEM_PROMPT = `You suggest coffees a person is likely to enjoy, based ONLY on the taste-preference summary provided. Every suggestion must cite, in "basedOn", the specific preference values it is grounded in. Never invent a roaster name, product name, price, or availability — describe the *kind* of coffee to look for instead. If the summary is too thin to justify a suggestion, return fewer suggestions rather than guessing. Output must match the supplied JSON schema exactly.`;

function isPreferenceSummary(value: unknown): value is PreferenceSummary {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['favoriteOrigins']) && typeof v['totalRatings'] === 'number';
}

async function callAzureOpenAi(
  config: OpenAiConfig,
  summary: PreferenceSummary,
  max: number,
): Promise<{ parsed: unknown; model: string }> {
  const result = await callResponses(config, {
    system: RECOMMEND_SYSTEM_PROMPT,
    user: `Suggest at most ${max} coffees for this taste profile:\n\n${JSON.stringify(summary)}`,
    format: {
      type: 'json_schema',
      name: 'recommendations',
      strict: true,
      schema: RECOMMENDATION_SCHEMA,
    },
    temperature: 0.4,
  });
  return { parsed: parseJsonOutput(result.text), model: result.model };
}

app.http('recommend', {
  methods: ['POST'],
  // Anonymous by design: Static Web Apps linked backends cannot forward a
  // function key, and the link enables Easy Auth on the Function App so the
  // only caller that can reach it is the Static Web App front door.
  authLevel: 'anonymous',
  route: 'recommend',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await readJson<RecommendRequest>(req);
      if (!isPreferenceSummary(body.preferences)) {
        return errorResponse(ctx, 400, 'preferences summary is required');
      }
      const summary = body.preferences;
      const max = typeof body.max === 'number' ? Math.min(Math.max(body.max, 1), 5) : 3;

      // Too little history to ground anything: say so rather than inventing taste.
      if (summary.totalRatings < 3) {
        return json(200, { recommendations: [], model: 'none', reason: 'insufficient-history' });
      }

      const openAi = getOpenAiConfig();

      let candidate: unknown;
      let model: string;

      if (openAi) {
        const result = await callAzureOpenAi(openAi, summary, max);
        candidate = result.parsed;
        model = result.model;
      } else {
        candidate = mockRecommendations(summary);
        model = 'mock-model';
      }

      const validation = validateRecommendations(candidate);
      if (!validation.valid) {
        ctx.warn('recommendation output failed validation', { errors: validation.errors });
        return json(422, {
          error: 'Model output did not match the expected schema',
          details: validation.errors,
          model,
        });
      }

      return json(200, {
        recommendations: validation.value.recommendations.slice(0, max),
        model,
      });
    } catch (err) {
      return errorResponse(ctx, 500, 'Recommend failed', err);
    }
  },
});
