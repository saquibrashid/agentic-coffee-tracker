import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import { AI_RATE_LIMIT } from '../lib/rateLimit.js';
import { enforceRateLimit } from '../lib/rateLimitHttp.js';
import { safeFetch, UnsafeUrlError } from '../lib/safeFetch.js';
import { callResponses, getOpenAiConfig, parseJsonOutput } from '../lib/openai.js';
import {
  buildQueryLadder,
  rankHits,
  roasterDomainCandidates,
  type RankableHit,
} from '../lib/productSearch.js';
import { isWebSearchEnabled, searchWeb } from '../lib/webSearch.js';

interface SearchRequest {
  roaster?: unknown;
  name?: unknown;
  max?: unknown;
}

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

/**
 * Finds the page where a coffee is sold, cheapest route first.
 *
 * The first route asks the roaster's own store. It costs nothing beyond a
 * request or two, and it resolves most roasters, because most run Shopify and
 * expose a predictable JSON search endpoint.
 *
 * Asking the model for full product URLs was tried first and does not work: it
 * confidently returns plausible paths that 404. Every URL returned by this
 * route came back from a store that actually listed the product.
 *
 * Finding the store is therefore the whole problem, and it is done twice over:
 * the model is asked, and candidates are derived from the roaster's name. The
 * model alone is not enough — it answers from recognition, so it goes quiet on
 * smaller roasters and on spellings it has not seen. Both are only guesses, and
 * a wrong one costs a single request that returns nothing.
 *
 * The structural limit of that route is that it only sees roasters selling
 * through Shopify. One who does not — Blue Bottle, for instance — is invisible
 * to it no matter how the domain is spelled, and no improvement to the guessing
 * could ever have changed that.
 *
 * So when it comes back empty, a general web search runs (see `webSearch.ts`).
 * That has no such blind spot, but it is billed per lookup, which is why it is
 * the fallback and not the first thing tried.
 */

interface DomainGuess {
  domains?: unknown;
}

const DOMAIN_SYSTEM_PROMPT = [
  'You identify the official online store domain for specialty coffee roasters.',
  'Given a roaster name, reply with JSON: {"domains":["example.com"]}.',
  'List at most 3 domains, most likely first, apex domain only (no scheme, no path).',
  "Only include a domain you actually recognise as that roaster's own store.",
  'If you do not recognise the roaster, reply {"domains":[]}. Do not guess.',
].join(' ');

async function guessRoasterDomains(roaster: string, ctx: InvocationContext): Promise<string[]> {
  const config = getOpenAiConfig();
  if (!config) return [];

  let content: string;
  try {
    const result = await callResponses(config, {
      system: DOMAIN_SYSTEM_PROMPT,
      user: `Roaster: ${roaster}`,
      format: { type: 'json_object' },
      temperature: 0,
      timeoutMs: 20_000,
    });
    content = result.text;
  } catch (err) {
    ctx.warn('domain lookup failed', { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
  if (!content) return [];

  const parsed = parseJsonOutput(content) as DomainGuess | undefined;
  if (!parsed || !Array.isArray(parsed.domains)) return [];

  return parsed.domains
    .filter((d): d is string => typeof d === 'string')
    .map((d) =>
      d
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, ''),
    )
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
    .slice(0, 3);
}

interface ShopifySuggestResponse {
  resources?: {
    results?: {
      products?: {
        title?: string;
        url?: string;
        body?: string;
        vendor?: string;
      }[];
    };
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Asks a store for products matching a query.
 *
 * Most specialty roasters run Shopify, which exposes a predictable JSON search
 * endpoint. When it answers, the results are real products with real URLs.
 *
 * Returns `null` — as distinct from an empty list — when the endpoint is not a
 * usable Shopify store search at all. The caller needs that difference to tell
 * "this domain does not exist" from "this store has no such coffee", so a
 * guessed domain that turns out to be nothing costs one request rather than a
 * whole ladder of them.
 */
export async function searchShopify(
  domain: string,
  query: string,
  max: number,
): Promise<RankableHit[] | null> {
  const params = new URLSearchParams({
    q: query,
    'resources[type]': 'product',
    'resources[limit]': String(Math.min(max, 10)),
  });
  const result = await safeFetch(`https://${domain}/search/suggest.json?${params.toString()}`, {
    accept: 'application/json',
  });
  if (result.status !== 200 || !result.contentType.includes('json')) return null;

  let data: ShopifySuggestResponse;
  try {
    data = JSON.parse(result.body) as ShopifySuggestResponse;
  } catch {
    return null;
  }

  const products = data.resources?.results?.products ?? [];
  return products.flatMap((p) => {
    if (!p.url || !p.title) return [];
    // The suggest API returns site-relative URLs carrying tracking parameters.
    const absolute = new URL(p.url, `https://${domain}`);
    absolute.search = '';
    return [
      {
        url: absolute.toString(),
        title: p.vendor ? `${p.title} — ${p.vendor}` : p.title,
        snippet: stripHtml(p.body ?? '').slice(0, 300),
        // Kept apart from the display title: the vendor suffix is the roaster's
        // name, which would match every product on the store equally and so
        // flatten the scoring it is not meant to take part in.
        productTitle: p.title,
      },
    ];
  });
}

/**
 * Works down the query ladder until a store returns something that genuinely
 * matches, rather than stopping at the first query that returns *anything*.
 *
 * The distinction is the point: a store search will happily answer a loose
 * query with coffees that share one word, and treating that as success would
 * end the search on a result the ranker is about to throw away.
 */
async function searchStore(
  domain: string,
  name: string,
  max: number,
  ctx: InvocationContext,
): Promise<RankableHit[]> {
  for (const query of buildQueryLadder(name)) {
    const hits = await searchShopify(domain, query, max);
    // Not a store: loosening the query cannot change that, so stop paying for it.
    if (hits === null) return [];

    const ranked = rankHits(name, hits);
    if (ranked.length > 0) {
      if (query !== name) ctx.log('matched on a relaxed query', { name, query });
      return ranked;
    }
  }
  return [];
}

function mockResults(roaster: string, name: string): SearchHit[] {
  return [
    {
      url: 'https://mockroaster.example/espresso-blend',
      title: `${roaster} ${name} — Mock Roaster`,
      snippet: 'Mock search snippet: a delicious espresso blend with chocolate notes.',
    },
  ];
}

app.http('search', {
  methods: ['POST'],
  // Anonymous by design: Static Web Apps linked backends cannot forward a
  // function key, and the link enables Easy Auth on the Function App so the
  // only caller that can reach it is the Static Web App front door.
  authLevel: 'anonymous',
  route: 'search',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await readJson<SearchRequest>(req);
      if (typeof body.roaster !== 'string' || typeof body.name !== 'string') {
        return errorResponse(ctx, 400, 'roaster and name are required');
      }
      const max = typeof body.max === 'number' ? body.max : 5;

      const limited = enforceRateLimit(req, ctx, {
        name: 'search',
        config: AI_RATE_LIMIT,
        message: 'Too many lookups at once. Try again shortly.',
      });
      if (limited) return limited;

      ctx.log('search invoked', { roaster: body.roaster, name: body.name });

      // Without a model there is no way to resolve a roaster to a domain, so the
      // endpoint degrades to its fixture like every other unconfigured endpoint.
      if (!getOpenAiConfig()) {
        return json(200, {
          results: mockResults(body.roaster, body.name),
          provider: 'mock-search',
        });
      }

      const guessed = await guessRoasterDomains(body.roaster, ctx);

      // The model's answers first — it handles the cases a name cannot predict,
      // such as a national TLD or a domain unrelated to the roaster's name —
      // then the derived candidates, which cover the far more common case of a
      // roaster the model simply does not recognise under that spelling.
      const domains: string[] = [];
      for (const domain of [...guessed, ...roasterDomainCandidates(body.roaster)]) {
        if (!domains.includes(domain)) domains.push(domain);
      }

      let hits: RankableHit[] = [];
      let provider = 'roaster-site';
      for (const domain of domains.slice(0, 8)) {
        try {
          const found = await searchStore(domain, body.name, max, ctx);
          if (found.length > 0) {
            // The first store that recognises the coffee is the roaster's own.
            // Carrying on would only add the same product from lookalike
            // domains, at a round-trip each.
            hits = found;
            ctx.log('matched on store', { domain, guessed: guessed.includes(domain) });
            break;
          }
        } catch (err) {
          // One unreachable or non-Shopify store must not fail the whole search.
          if (!(err instanceof UnsafeUrlError)) ctx.warn('store search failed', { domain });
        }
      }

      // Only now, having spent nothing and found nothing, is the paid search
      // worth it. Roasters who are not on Shopify reach the app through here.
      if (hits.length === 0 && isWebSearchEnabled()) {
        const config = getOpenAiConfig();
        if (config) {
          hits = await searchWeb(config, body.roaster, body.name, max, ctx);
          if (hits.length > 0) provider = 'web-search';
        }
      }

      const seen = new Set<string>();
      const results = hits
        .filter((h) => (seen.has(h.url) ? false : seen.add(h.url)))
        .slice(0, max)
        .map(({ url, title, snippet }) => ({ url, title, snippet }));

      return json(200, { results, provider });
    } catch (err) {
      return errorResponse(ctx, 500, 'Search failed', err);
    }
  },
});
