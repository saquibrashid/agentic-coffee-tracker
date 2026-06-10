import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';

interface ParseRequest {
  ocrText?: unknown;
  model?: unknown;
}

/**
 * POST /api/parse — stub. Replace with Azure OpenAI structured-output call
 * using the JSON schema defined in specs/data-model.md.
 */
app.http('parse', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'parse',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await readJson<ParseRequest>(req);
      if (typeof body.ocrText !== 'string') {
        return errorResponse(ctx, 400, 'ocrText is required');
      }
      ctx.log('parse invoked', { length: body.ocrText.length });

      // Return a mocked structured parse result matching the LLM schema
      return json(200, {
        parsed: {
          bean: {
            id: `mock-bean-${Date.now()}`,
            name: 'Mock Roaster Espresso Blend',
            roastDate: null,
            origin: [{ country: 'Mockland' }],
            roastLevel: 'medium',
            varietals: ['mock-arabica'],
            tastingNotes: ['chocolate', 'caramel', 'sweet'],
            metadata: { weightGrams: 20, brewMethod: 'espresso' },
          },
          confidence: 0.92,
          rawText: body.ocrText,
        },
        model: (body.model as string) || 'mock-model',
      });
    } catch (err) {
      return errorResponse(ctx, 500, 'Parse failed', err);
    }
  },
});
