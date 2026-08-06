import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import { safeFetch, UnsafeUrlError } from '../lib/safeFetch.js';
import { callResponses, getOpenAiConfig, parseJsonOutput } from '../lib/openai.js';

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
 * There is no general web search API available here. Bing Search v7 is retired
 * to new customers, and its replacement (Grounding with Bing) is priced per
 * thousand queries with no free tier, which is hard to justify for a personal
 * app that already pays for a language model.
 *
 * So this endpoint does the one search that actually matters: find the coffee
 * on the roaster's own store. The model is asked only for the roaster's
 * storefront domain — a fact it knows reliably — and the product lookup runs
 * against that store's own search, which returns real listings.
 *
 * Asking the model for full product URLs was tried first and does not work: it
 * confidently returns plausible paths that 404. Every URL returned here came
 * back from a store that actually listed the product.
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
 * Most specialty roasters run Shopify, which exposes a predictable JSON search
 * endpoint. When it answers, the results are real products with real URLs.
 */
export async function searchShopify(domain: string, query: string, max: number): Promise<SearchHit[]> {
  const params = new URLSearchParams({
    q: query,
    'resources[type]': 'product',
    'resources[limit]': String(Math.min(max, 10)),
  });
  const result = await safeFetch(`https://${domain}/search/suggest.json?${params.toString()}`, {
    accept: 'application/json',
  });
  if (result.status !== 200 || !result.contentType.includes('json')) return [];

  let data: ShopifySuggestResponse;
  try {
    data = JSON.parse(result.body) as ShopifySuggestResponse;
  } catch {
    return [];
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
      },
    ];
  });
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
      ctx.log('search invoked', { roaster: body.roaster, name: body.name });

      // Without a model there is no way to resolve a roaster to a domain, so the
      // endpoint degrades to its fixture like every other unconfigured endpoint.
      if (!getOpenAiConfig()) {
        return json(200, {
          results: mockResults(body.roaster, body.name),
          provider: 'mock-search',
        });
      }

      const domains = await guessRoasterDomains(body.roaster, ctx);
      const hits: SearchHit[] = [];

      for (const domain of domains) {
        if (hits.length >= max) break;
        try {
          hits.push(...(await searchShopify(domain, body.name, max)));
        } catch (err) {
          // One unreachable or non-Shopify store must not fail the whole search.
          if (!(err instanceof UnsafeUrlError)) ctx.warn('store search failed', { domain });
        }
      }

      const seen = new Set<string>();
      const results = hits.filter((h) => (seen.has(h.url) ? false : seen.add(h.url))).slice(0, max);

      return json(200, { results, provider: 'roaster-site' });
    } catch (err) {
      return errorResponse(ctx, 500, 'Search failed', err);
    }
  },
});
