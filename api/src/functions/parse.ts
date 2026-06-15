import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';

interface ParseRequest {
  ocrText?: unknown;
  model?: unknown;
}

const PARSE_SYSTEM_PROMPT = `You extract structured coffee bean metadata from OCR text. Return strict JSON matching the schema. Use null when unknown. Do not include any prose outside JSON.`;

async function callAzureOpenAi(ocrText: string, model?: string): Promise<{ parsed: unknown; model: string }> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/$/, '');
  const key = process.env.AZURE_OPENAI_KEY!;
  const deployment = model || process.env.AZURE_OPENAI_DEPLOYMENT!;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview';
  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: PARSE_SYSTEM_PROMPT },
        { role: 'user', content: `Extract a bean object from this OCR text:\n\n${ocrText}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`Azure OpenAI returned ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content || '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { raw: content };
  }
  return { parsed, model: deployment };
}

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

      if (process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY && process.env.AZURE_OPENAI_DEPLOYMENT) {
        const result = await callAzureOpenAi(body.ocrText, typeof body.model === 'string' ? body.model : undefined);
        return json(200, result);
      }

      return json(200, {
        parsed: {
          bean: {
            name: 'Mock Roaster Espresso Blend',
            roaster: 'Mock Roaster',
            roastLevel: 'medium',
            origins: [{ country: 'Mockland' }],
            tastingNotes: ['chocolate', 'caramel', 'sweet'],
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
