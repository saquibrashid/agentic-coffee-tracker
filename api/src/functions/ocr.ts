import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';

interface OcrRequest {
  imageBase64?: unknown;
  mimeType?: unknown;
}

async function callAzureVision(imageBase64: string): Promise<{ rawText: string; providerVersion?: string }> {
  const endpoint = process.env.AZURE_VISION_ENDPOINT!.replace(/\/$/, '');
  const key = process.env.AZURE_VISION_KEY!;
  const url = `${endpoint}/computervision/imageanalysis:analyze?features=read&api-version=2024-02-01`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/octet-stream',
    },
    body: Buffer.from(imageBase64, 'base64'),
  });
  if (!res.ok) {
    throw new Error(`Azure Vision returned ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { readResult?: { blocks?: { lines?: { text?: string }[] }[] } };
  const lines = data.readResult?.blocks?.flatMap((b) => b.lines || []) ?? [];
  const rawText = lines.map((l) => l.text || '').join('\n');
  return { rawText, providerVersion: '2024-02-01' };
}

app.http('ocr', {
  methods: ['POST'],
  // Anonymous by design: Static Web Apps linked backends cannot forward a
  // function key, and the link enables Easy Auth on the Function App so the
  // only caller that can reach it is the Static Web App front door.
  authLevel: 'anonymous',
  route: 'ocr',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await readJson<OcrRequest>(req);
      if (typeof body.imageBase64 !== 'string' || typeof body.mimeType !== 'string') {
        return errorResponse(ctx, 400, 'imageBase64 and mimeType are required strings');
      }
      ctx.log('ocr invoked', { mimeType: body.mimeType, bytes: body.imageBase64.length });

      if (process.env.AZURE_VISION_ENDPOINT && process.env.AZURE_VISION_KEY) {
        const result = await callAzureVision(body.imageBase64);
        return json(200, { ...result, provider: 'azure-vision' });
      }

      // Mock fallback for local/dev
      return json(200, {
        rawText: 'Mock OCR: Bag label with roaster Mock Roaster and tasting notes: chocolate, caramel',
        provider: 'mock-vision',
        providerVersion: '0.1',
      });
    } catch (err) {
      return errorResponse(ctx, 500, 'OCR failed', err);
    }
  },
});
