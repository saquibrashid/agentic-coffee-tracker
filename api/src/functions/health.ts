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

/**
 * Sync deliberately reports 'disabled' rather than 'mock'. The AI endpoints fall
 * back to synthetic data, which is a reasonable degraded state. There is no
 * honest mock for durable storage: reporting a working sync while records went
 * nowhere would tell people their notes were safe on another device when they
 * were not.
 */
function syncModeOf(...vars: string[]): 'live' | 'disabled' {
  return vars.every((name) => Boolean(process.env[name])) ? 'live' : 'disabled';
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
    studioPhoto: 'live' | 'mock';
    sync: 'live' | 'disabled';
    feedback: 'live' | 'disabled';
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
        // Search resolves the roaster's storefront with the model, then queries
        // that store directly, so it is live whenever the model is.
        search: openAi,
        recommend: openAi,
        // A separate resource from the chat model, not just a separate
        // deployment: MAI image models are not offered in every region an Azure
        // OpenAI account can live in, so they carry their own endpoint and key.
        studioPhoto: modeOf('AZURE_IMAGE_ENDPOINT', 'AZURE_IMAGE_KEY', 'AZURE_IMAGE_DEPLOYMENT'),
        sync: syncModeOf(
          'COSMOS_ENDPOINT',
          'COSMOS_DATABASE',
          'COSMOS_CONTAINER',
          'PHOTO_STORAGE_ACCOUNT',
          'PHOTO_CONTAINER',
        ),
        // 'disabled' rather than 'mock' for the same reason as sync: there is
        // no honest mock for "your words reached somebody".
        feedback: syncModeOf('GITHUB_FEEDBACK_TOKEN', 'GITHUB_FEEDBACK_REPO'),
      },
    };
    ctx.log('health probe', body.services);
    return json(200, body);
  },
});
