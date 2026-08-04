import { app, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { json } from '../lib/http.js';

/**
 * Reports which upstream integrations are configured. Every endpoint falls back
 * to a deterministic mock when its credentials are absent, so `mode: 'mock'` is
 * a healthy state — it just means the response is synthetic.
 */
function modeOf(...vars: string[]): 'live' | 'mock' {
  return vars.every((name) => Boolean(process.env[name])) ? 'live' : 'mock';
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  timestamp: string;
  services: {
    ocr: 'live' | 'mock';
    parse: 'live' | 'mock';
    search: 'live' | 'mock';
    recommend: 'live' | 'mock';
  };
}

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: (_req, ctx: InvocationContext): HttpResponseInit => {
    const openAi = modeOf('AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_KEY', 'AZURE_OPENAI_DEPLOYMENT');
    const body: HealthResponse = {
      status: 'ok',
      version: process.env['APP_VERSION'] ?? '0.1.0',
      timestamp: new Date().toISOString(),
      services: {
        ocr: modeOf('AZURE_VISION_ENDPOINT', 'AZURE_VISION_KEY'),
        parse: openAi,
        search: modeOf('BING_SEARCH_KEY'),
        recommend: openAi,
      },
    };
    ctx.log('health probe', body.services);
    return json(200, body);
  },
});
