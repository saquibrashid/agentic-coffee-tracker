import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';

interface OcrRequest {
  imageBase64?: unknown;
  mimeType?: unknown;
}

/**
 * POST /api/ocr — stub. Replace with Azure AI Vision call.
 * See specs/architecture.md "BFF Endpoints" and specs/ai.md "OCR Pipeline".
 */
app.http('ocr', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'ocr',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await readJson<OcrRequest>(req);
      if (typeof body.imageBase64 !== 'string' || typeof body.mimeType !== 'string') {
        return errorResponse(ctx, 400, 'imageBase64 and mimeType are required strings');
      }
      ctx.log('ocr invoked', { mimeType: body.mimeType, bytes: body.imageBase64.length });

      // Mock OCR response for local development and CI
      return json(200, {
        rawText: 'Mock OCR extracted text: Bag label with roaster Mock Roaster and tasting notes: chocolate, caramel',
        provider: 'mock-vision',
        providerVersion: '0.1',
      });
    } catch (err) {
      return errorResponse(ctx, 500, 'OCR failed', err);
    }
  },
});
