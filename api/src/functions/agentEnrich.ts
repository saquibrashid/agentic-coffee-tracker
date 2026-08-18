import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import { AGENT_RATE_LIMIT } from '../lib/rateLimit.js';
import { enforceRateLimit } from '../lib/rateLimitHttp.js';
import { getOpenAiConfig, type TokenUsage } from '../lib/openai.js';
import { safeFetch } from '../lib/safeFetch.js';
import { readPageText } from '../lib/pageText.js';
import { extractImageUrl } from '../lib/extractImage.js';
import { rankHits } from '../lib/productSearch.js';
import { isWebSearchEnabled, searchWeb } from '../lib/webSearch.js';
import { searchShopify } from './search.js';
import {
  AgentFailedError,
  runEnrichAgent,
  type AgentDeps,
  type FetchedPage,
  type StoreHit,
} from '../lib/agent.js';

/**
 * The agentic enrichment path from `specs/agentic-backend.md` §7.
 *
 * This is an experiment that exists to be measured, not a replacement. It
 * takes the same input as the first step of the current ladder — a roaster and
 * a coffee name — and returns what `/api/parse` returns at the end of it, so
 * the two can be compared on identical inputs and a client could be pointed at
 * either without noticing.
 *
 * **Off unless `AGENT_ENRICH_ENABLED` is set.** A flag rather than a branch in
 * the existing endpoint, because the comparison needs both paths alive at the
 * same time on the same deployment, and because an unbounded-by-construction
 * loop should be something a deployment opts into rather than something it
 * inherits.
 */
function isAgentEnabled(): boolean {
  const setting = process.env['AGENT_ENRICH_ENABLED'];
  return setting === 'true' || setting === '1';
}

interface AgentEnrichRequest {
  roaster?: unknown;
  name?: unknown;
}

/**
 * The real capabilities behind the tools.
 *
 * Each one is the same code the pipeline uses — `searchShopify` and `rankHits`
 * from the store path, `searchWeb` from the paid fallback, `safeFetch` plus
 * `readPageText` from `/api/scrape`. That is deliberate: if the agent wins on
 * the measurements, it has to be because choosing the order helped, not
 * because it quietly got better tools than the pipeline had.
 */
function liveDeps(ctx: InvocationContext): Partial<AgentDeps> {
  return {
    log: (message, data) => {
      ctx.log(message, data);
    },
    searchStore: async (domain: string, query: string): Promise<StoreHit[]> => {
      const hits = await searchShopify(domain, query, 5);
      // `null` means the domain is not a store at all. The model is told the
      // same thing either way — no results — because the distinction only
      // mattered to the pipeline, which used it to decide whether to keep
      // loosening the query. Here the model decides that itself.
      if (!hits) return [];
      return rankHits(query, hits).map(({ url, title, snippet }) => ({ url, title, snippet }));
    },
    searchWeb: async (roaster: string, name: string) => {
      if (!isWebSearchEnabled()) return { hits: [] };
      const config = getOpenAiConfig();
      if (!config) return { hits: [] };
      // The hosted search runs a model call of its own, and it is the most
      // expensive single thing either path does. Feeding its usage back into
      // the trace is what stops the agent's cost looking artificially low on
      // exactly the roasters that need it.
      let usage: TokenUsage | undefined;
      const hits = await searchWeb(config, roaster, name, 5, ctx, (u) => {
        usage = u;
      });
      return {
        hits: hits.map(({ url, title, snippet }) => ({ url, title, snippet })),
        ...(usage ? { usage } : {}),
      };
    },
    fetchPage: async (url: string): Promise<FetchedPage> => {
      const res = await safeFetch(url);
      if (res.status !== 200) throw new Error(`Fetch returned ${res.status}`);
      const page = readPageText(res.body, res.finalUrl);
      const imageUrl = extractImageUrl(res.body, res.finalUrl) ?? page.imageUrl;
      return {
        text: page.text,
        finalUrl: res.finalUrl,
        ...(imageUrl ? { imageUrl } : {}),
      };
    },
  };
}

app.http('agentEnrich', {
  methods: ['POST'],
  // Anonymous by design: Static Web Apps linked backends cannot forward a
  // function key, and the link enables Easy Auth on the Function App so the
  // only caller that can reach it is the Static Web App front door.
  authLevel: 'anonymous',
  route: 'agent-enrich',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      if (!isAgentEnabled()) {
        return errorResponse(ctx, 404, 'The agentic enrichment path is not enabled');
      }

      const body = await readJson<AgentEnrichRequest>(req);
      if (typeof body.roaster !== 'string' || typeof body.name !== 'string') {
        return errorResponse(ctx, 400, 'roaster and name are required');
      }

      const limited = enforceRateLimit(req, ctx, {
        name: 'agent-enrich',
        config: AGENT_RATE_LIMIT,
        message: 'Too many lookups at once. Try again shortly.',
      });
      if (limited) return limited;

      const config = getOpenAiConfig();
      if (!config) {
        // Unlike the pipeline endpoints there is no useful fixture to fall back
        // to: the whole subject of the experiment is what the model decides to
        // do, and a canned answer would measure nothing.
        return errorResponse(ctx, 503, 'The agentic path requires a configured model');
      }

      ctx.log('agent enrich invoked', { roaster: body.roaster, name: body.name });

      const result = await runEnrichAgent(
        config,
        { roaster: body.roaster, name: body.name },
        liveDeps(ctx),
      );

      ctx.log('agent enrich finished', {
        stopReason: result.trace.stopReason,
        steps: result.trace.steps,
        tokens: result.trace.usage.inputTokens + result.trace.usage.outputTokens,
        paidSearches: result.trace.paidSearches,
        ms: result.trace.ms,
      });

      return json(200, {
        parsed: result.parsed,
        model: result.model,
        ...(result.sourceUrl ? { sourceUrl: result.sourceUrl } : {}),
        ...(result.imageUrl ? { imageUrl: result.imageUrl } : {}),
        // Returned rather than only logged, so the comparison harness can read
        // cost and path per request without scraping Application Insights.
        trace: result.trace,
      });
    } catch (err) {
      if (err instanceof AgentFailedError) {
        // 422 matches `/api/parse`: the request was fine, the model's answer
        // was not, and the client's recovery is the same manual-entry path.
        ctx.warn('agent enrich failed', { reason: err.trace.stopReason, message: err.message });
        return json(422, { error: err.message, trace: err.trace });
      }
      return errorResponse(ctx, 500, 'Agent enrichment failed', err);
    }
  },
});
