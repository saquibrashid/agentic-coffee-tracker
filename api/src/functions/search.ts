import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';

interface SearchRequest {
  roaster?: unknown;
  name?: unknown;
  max?: unknown;
}

/**
 * POST /api/search — stub. Replace with Bing Web Search v7 call.
 * Cache results for 24h keyed by (roaster|name).
 */
app.http('search', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'search',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await readJson<SearchRequest>(req);
      if (typeof body.roaster !== 'string' || typeof body.name !== 'string') {
        return errorResponse(ctx, 400, 'roaster and name are required');
      }
      ctx.log('search invoked', { roaster: body.roaster, name: body.name });

      // Mock search results
      return json(200, {
        results: [
          {
            url: 'https://mockroaster.example/espresso-blend',
            title: `${body.roaster} ${body.name} — Mock Roaster`,
            snippet: 'Mock search snippet: a delicious espresso blend with chocolate notes.',
          },
        ],
      });
    } catch (err) {
      return errorResponse(ctx, 500, 'Search failed', err);
    }
  },
});
