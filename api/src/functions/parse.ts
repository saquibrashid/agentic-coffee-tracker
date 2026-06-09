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

      return json(501, {
        parsed: null,
        model: '',
        notice: 'Not yet wired — implement Azure OpenAI structured-output call.',
      });
    } catch (err) {
      return errorResponse(ctx, 500, 'Parse failed', err);
    }
  },
});
