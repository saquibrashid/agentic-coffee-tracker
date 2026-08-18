import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import { AI_RATE_LIMIT } from '../lib/rateLimit.js';
import { enforceRateLimit } from '../lib/rateLimitHttp.js';
import {
  callResponses,
  getOpenAiConfig,
  parseJsonOutput,
  type OpenAiConfig,
  type TokenUsage,
} from '../lib/openai.js';
import { PARSE_SYSTEM_PROMPT } from '../lib/parsePrompt.js';
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

interface RawParseResult {
  parsed: unknown;
  model: string;
  rawContent: string;
  usage: TokenUsage;
}

async function callAzureOpenAi(
  config: OpenAiConfig,
  ocrText: string,
  model?: string,
): Promise<RawParseResult> {
  const result = await callResponses(config, {
    system: PARSE_SYSTEM_PROMPT,
    user: `Extract a bean object from this text:\n\n${ocrText}`,
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
    usage: result.usage,
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

      const limited = enforceRateLimit(req, ctx, {
        name: 'parse',
        config: AI_RATE_LIMIT,
        message: 'Too many labels at once. Try again shortly.',
      });
      if (limited) return limited;

      ctx.log('parse invoked', { length: body.ocrText.length });

      const openAi = getOpenAiConfig();

      let candidate: unknown;
      let model: string;
      let rawContent = '';
      let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

      if (openAi) {
        const result = await callAzureOpenAi(
          openAi,
          body.ocrText,
          typeof body.model === 'string' ? body.model : undefined,
        );
        candidate = result.parsed;
        model = result.model;
        rawContent = result.rawContent;
        usage = result.usage;
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
      return json(200, { parsed, model, rawText: body.ocrText, usage });
    } catch (err) {
      return errorResponse(ctx, 500, 'Parse failed', err);
    }
  },
});
