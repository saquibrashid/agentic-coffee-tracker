import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';

interface ScrapeRequest {
  url?: unknown;
}

const DEFAULT_ALLOWLIST = ['*.example', 'bluebottlecoffee.com', 'counterculturecoffee.com', 'intelligentsiacoffee.com'];

function isAllowed(url: string, allowlist: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowlist.some((pattern) => {
      if (pattern.startsWith('*.')) {
        return host.endsWith(pattern.slice(1));
      }
      return host === pattern;
    });
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
  authLevel: 'function',
  route: 'scrape',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await readJson<ScrapeRequest>(req);
      if (typeof body.url !== 'string') {
        return errorResponse(ctx, 400, 'url is required');
      }

      const allowlist = (process.env.SCRAPE_ALLOWLIST?.split(',').map((s) => s.trim()) || DEFAULT_ALLOWLIST).filter(
        Boolean,
      );
      if (!isAllowed(body.url, allowlist)) {
        return errorResponse(ctx, 400, `URL host is not in allowlist`);
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

      const res = await fetch(body.url, { headers: { 'user-agent': 'AgenticCoffeeBot/0.1 (+https://github.com/saquibrashid/agentic-coffee-tracker)' } });
      if (!res.ok) {
        return errorResponse(ctx, 502, `Fetch returned ${res.status}`);
      }
      const html = await res.text();
      const text = extractTextFromHtml(html);

      // If Azure OpenAI is configured, call /api/parse-equivalent inline. For brevity we return the text.
      return json(200, {
        extracted: { rawText: text },
        sourceUrl: body.url,
      });
    } catch (err) {
      return errorResponse(ctx, 500, 'Scrape failed', err);
    }
  },
});
