import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
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

async function callAzureOpenAi(summary: PreferenceSummary, max: number): Promise<{ parsed: unknown; model: string }> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/$/, '');
  const key = process.env.AZURE_OPENAI_KEY!;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT!;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview';
  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: RECOMMEND_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Suggest at most ${max} coffees for this taste profile:\n\n${JSON.stringify(summary)}`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'recommendations', strict: true, schema: RECOMMENDATION_SCHEMA },
      },
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`Azure OpenAI returned ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content || '{}');
  } catch {
    parsed = undefined;
  }
  return { parsed, model: deployment };
}

app.http('recommend', {
  methods: ['POST'],
  authLevel: 'function',
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

      const useAzure = Boolean(
        process.env.AZURE_OPENAI_ENDPOINT &&
          process.env.AZURE_OPENAI_KEY &&
          process.env.AZURE_OPENAI_DEPLOYMENT,
      );

      let candidate: unknown;
      let model: string;

      if (useAzure) {
        const result = await callAzureOpenAi(summary, max);
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
