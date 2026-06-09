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

      // TODO: Call Azure AI Vision /imageanalysis:analyze with features=read.
      return json(501, {
        rawText: '',
        provider: 'azure-vision',
        notice: 'Not yet wired — implement Azure Vision call.',
      });
    } catch (err) {
      return errorResponse(ctx, 500, 'OCR failed', err);
    }
  },
});
