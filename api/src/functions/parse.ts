import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import {
  PARSED_BEAN_SCHEMA,
  mockParsedBean,
  validateParsedBean,
  type ParsedBean,
} from '../lib/beanSchema.js';

interface ParseRequest {
  ocrText?: unknown;
  model?: unknown;
}

const PARSE_SYSTEM_PROMPT = `You extract structured coffee bean metadata from OCR text of a coffee bag. Return ONLY fields present in or strongly implied by the text. Use null for anything unknown — do not guess. Normalize roast level and process to the provided enums. Output must match the supplied JSON schema exactly.`;

interface RawParseResult {
  parsed: unknown;
  model: string;
  rawContent: string;
}

async function callAzureOpenAi(ocrText: string, model?: string): Promise<RawParseResult> {
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
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'parsed_bean', strict: true, schema: PARSED_BEAN_SCHEMA },
      },
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(`Azure OpenAI returned ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const rawContent = data.choices?.[0]?.message?.content ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent || '{}');
  } catch {
    parsed = undefined;
  }
  return { parsed, model: deployment, rawContent };
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

      const useAzure = Boolean(
        process.env.AZURE_OPENAI_ENDPOINT &&
          process.env.AZURE_OPENAI_KEY &&
          process.env.AZURE_OPENAI_DEPLOYMENT,
      );

      let candidate: unknown;
      let model: string;
      let rawContent = '';

      if (useAzure) {
        const result = await callAzureOpenAi(
          body.ocrText,
          typeof body.model === 'string' ? body.model : undefined,
        );
        candidate = result.parsed;
        model = result.model;
        rawContent = result.rawContent;
      } else {
        candidate = mockParsedBean(body.ocrText);
        model = typeof body.model === 'string' ? body.model : 'mock-model';
      }

      const validation = validateParsedBean(candidate);
      if (!validation.valid) {
        // 422: the request was fine, the model's answer was not. The client marks
        // the bean `needsReview` and surfaces the raw OCR text for manual entry.
        ctx.warn('parse output failed schema validation', { errors: validation.errors });
        return json(422, {
          error: 'Model output did not match the expected schema',
          details: validation.errors,
          model,
          rawText: body.ocrText,
          rawContent,
        });
      }

      const parsed: ParsedBean = validation.value;
      return json(200, { parsed, model, rawText: body.ocrText });
    } catch (err) {
      return errorResponse(ctx, 500, 'Parse failed', err);
    }
  },
});
