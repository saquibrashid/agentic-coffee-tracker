import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import { safeFetch, UnsafeUrlError } from '../lib/safeFetch.js';

interface ScrapeRequest {
  url?: unknown;
}

/**
 * An optional stricter override. Left unset, any publicly routable host is
 * fetchable and safety rests on the address checks in `safeFetch` — which is
 * what makes enrichment work against roasters nobody hardcoded. Set it to pin
 * the deployment to a fixed set of stores.
 */
function allowlist(): string[] {
  return (process.env.SCRAPE_ALLOWLIST?.split(',').map((s) => s.trim()) ?? []).filter(Boolean);
}

function isAllowed(url: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return patterns.some((pattern) =>
      pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern,
    );
  } catch {
    return false;
  }
}

function extractTextFromHtml(html: string): string {
  // Naive: strip scripts/styles then tags. For production use a proper parser.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

/**
 * `.example` is reserved by RFC 2606 and never resolves, so a request for one
 * is unambiguously a mock. Every other endpoint degrades to a deterministic
 * response without credentials; scrape has to do the same or the whole
 * search -> scrape -> parse chain breaks on a credential-free deployment.
 */
function isMockHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith('.example');
  } catch {
    return false;
  }
}

app.http('scrape', {
  methods: ['POST'],
  // Anonymous by design: Static Web Apps linked backends cannot forward a
  // function key, and the link enables Easy Auth on the Function App so the
  // only caller that can reach it is the Static Web App front door.
  authLevel: 'anonymous',
  route: 'scrape',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await readJson<ScrapeRequest>(req);
      if (typeof body.url !== 'string') {
        return errorResponse(ctx, 400, 'url is required');
      }

      if (!isAllowed(body.url, allowlist())) {
        return errorResponse(ctx, 400, 'URL host is not in allowlist');
      }

      ctx.log('scrape invoked', { url: body.url });

      if (isMockHost(body.url)) {
        return json(200, {
          extracted: {
            rawText:
              'Mock scrape: Mock Roaster — Ethiopia Yirgacheffe. Washed process, light roast. ' +
              'Tasting notes: jasmine, bergamot, stone fruit. Grown at 1900-2100m.',
          },
          sourceUrl: body.url,
        });
      }

      const res = await safeFetch(body.url);
      if (res.status !== 200) {
        return errorResponse(ctx, 502, `Fetch returned ${res.status}`);
      }

      return json(200, {
        extracted: { rawText: extractTextFromHtml(res.body) },
        // The URL after redirects, so the recorded source is where the text
        // actually came from rather than where we started looking.
        sourceUrl: res.finalUrl,
      });
    } catch (err) {
      if (err instanceof UnsafeUrlError) return errorResponse(ctx, 400, err.message, err);
      return errorResponse(ctx, 500, 'Scrape failed', err);
    }
  },
});
