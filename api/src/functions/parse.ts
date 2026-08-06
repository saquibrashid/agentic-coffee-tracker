import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import {
  callResponses,
  getOpenAiConfig,
  parseJsonOutput,
  type OpenAiConfig,
} from '../lib/openai.js';
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

async function callAzureOpenAi(
  config: OpenAiConfig,
  ocrText: string,
  model?: string,
): Promise<RawParseResult> {
  const result = await callResponses(config, {
    system: PARSE_SYSTEM_PROMPT,
    user: `Extract a bean object from this OCR text:\n\n${ocrText}`,
    format: {
      type: 'json_schema',
      name: 'parsed_bean',
      strict: true,
      schema: PARSED_BEAN_SCHEMA,
    },
    temperature: 0,
    ...(model ? { model } : {}),
  });
  return {
    parsed: parseJsonOutput(result.text),
    model: result.model,
    rawContent: result.text,
  };
}

app.http('parse', {
  methods: ['POST'],
  // Anonymous by design: Static Web Apps linked backends cannot forward a
  // function key, and the link enables Easy Auth on the Function App so the
  // only caller that can reach it is the Static Web App front door.
  authLevel: 'anonymous',
  route: 'parse',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await readJson<ParseRequest>(req);
      if (typeof body.ocrText !== 'string') {
        return errorResponse(ctx, 400, 'ocrText is required');
      }
      ctx.log('parse invoked', { length: body.ocrText.length });

      const openAi = getOpenAiConfig();

      let candidate: unknown;
      let model: string;
      let rawContent = '';

      if (openAi) {
        const result = await callAzureOpenAi(
          openAi,
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
