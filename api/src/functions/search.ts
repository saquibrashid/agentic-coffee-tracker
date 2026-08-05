import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';

interface SearchRequest {
  roaster?: unknown;
  name?: unknown;
  max?: unknown;
}

interface BingSearchResponse {
  webPages?: {
    value?: { url: string; name: string; snippet: string }[];
  };
}

async function callBingSearch(roaster: string, name: string, max: number): Promise<{ results: { url: string; title: string; snippet: string }[] }> {
  const key = process.env.BING_SEARCH_KEY!;
  const endpoint = process.env.BING_SEARCH_ENDPOINT || 'https://api.bing.microsoft.com/v7.0/search';
  const q = encodeURIComponent(`${roaster} ${name} coffee`);
  const url = `${endpoint}?q=${q}&count=${Math.min(max, 10)}&safeSearch=Moderate`;
  const res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key } });
  if (!res.ok) throw new Error(`Bing returned ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as BingSearchResponse;
  return {
    results: (data.webPages?.value || []).map((v) => ({ url: v.url, title: v.name, snippet: v.snippet })),
  };
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

      if (process.env.BING_SEARCH_KEY) {
        const result = await callBingSearch(body.roaster, body.name, max);
        return json(200, result);
      }

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
