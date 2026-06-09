import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';

interface ScrapeRequest {
  url?: unknown;
}

/**
 * POST /api/scrape — stub. Domain-allowlisted HTML fetch + LLM extraction
 * against the same JSON schema as /api/parse.
 */
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
      ctx.log('scrape invoked', { url: body.url });

      return json(501, {
        extracted: null,
        sourceUrl: body.url,
        notice: 'Not yet wired — implement scrape + LLM extraction.',
      });
    } catch (err) {
      return errorResponse(ctx, 500, 'Scrape failed', err);
    }
  },
});
