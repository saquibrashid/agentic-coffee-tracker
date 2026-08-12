/**
 * Thin client for the Azure OpenAI **v1 API**.
 *
 * `POST {endpoint}/openai/v1/responses` is the current surface and needs no
 * dated `api-version`, unlike the older `/openai/deployments/{d}/chat/completions`
 * route it replaces. Strict structured outputs are supported here via
 * `text.format`, which the schema-validated endpoints depend on.
 *
 * `POST {endpoint}/openai/v1/images/edits` on the same resource serves the
 * image model, which is a separate deployment — see `getOpenAiImageConfig`.
 *
 * Auth is the `api-key` header. The keys are injected as Key Vault references,
 * so they never sit in the deployed configuration in plaintext.
 */

export interface OpenAiConfig {
  endpoint: string;
  key: string;
  deployment: string;
}

/** Returns null when the resource is not configured, which puts callers in mock mode. */
export function getOpenAiConfig(): OpenAiConfig | null {
  const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
  const key = process.env['AZURE_OPENAI_KEY'];
  const deployment = process.env['AZURE_OPENAI_DEPLOYMENT'];
  if (!endpoint || !key || !deployment) return null;
  return { endpoint: endpoint.replace(/\/$/, ''), key, deployment };
}

/**
 * The image model is a *second* deployment, not the chat one under another name.
 *
 * `AZURE_OPENAI_DEPLOYMENT` points at a text model, which cannot serve
 * `/images/edits` at all, so image generation gets its own variable rather than
 * reusing that one. Endpoint and key are shared, because both deployments live
 * on the same Azure OpenAI resource; only the deployment differs.
 *
 * Returns null when image generation is not configured, which puts the caller
 * in mock mode exactly as the text path does.
 */
export function getOpenAiImageConfig(): OpenAiConfig | null {
  const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
  const key = process.env['AZURE_OPENAI_KEY'];
  const deployment = process.env['AZURE_OPENAI_IMAGE_DEPLOYMENT'];
  if (!endpoint || !key || !deployment) return null;
  return { endpoint: endpoint.replace(/\/$/, ''), key, deployment };
}

export interface ImageEditRequest {
  /** The reference image the model must reproduce the packaging from. */
  image: Buffer;
  imageContentType: string;
  prompt: string;
  /** Square by default: the app's photos are stored square-cropped on cards. */
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  timeoutMs?: number;
}

export interface ImageEditResult {
  /** Raw bytes of the generated image. */
  bytes: Buffer;
  contentType: string;
  model: string;
}

/**
 * Edits an image with the deployed image model.
 *
 * `multipart/form-data` rather than JSON, because that is what `/images/edits`
 * accepts — the reference image is an uploaded file, not a base64 field.
 * `response_format` is deliberately *not* sent: the gpt-image family rejects it
 * and returns base64 regardless, so asking is both useless and an error.
 *
 * Generation is slow by the standards of the other endpoints — tens of seconds
 * is normal — so the default timeout is far longer than the 30s the text calls
 * use. A ceiling still exists, because a request that never returns would hold
 * a Function invocation open until the host kills it.
 */
export async function callImageEdit(
  config: OpenAiConfig,
  request: ImageEditRequest,
): Promise<ImageEditResult> {
  const form = new FormData();
  form.append('model', config.deployment);
  form.append('prompt', request.prompt);
  form.append('size', request.size ?? '1024x1024');
  form.append('quality', request.quality ?? 'high');
  form.append(
    'image',
    new Blob([new Uint8Array(request.image)], { type: request.imageContentType }),
    'reference.png',
  );

  const res = await fetch(`${config.endpoint}/openai/v1/images/edits`, {
    method: 'POST',
    // No Content-Type header: fetch derives it from the FormData, including the
    // multipart boundary, which cannot be written by hand.
    headers: { 'api-key': config.key },
    signal: AbortSignal.timeout(request.timeoutMs ?? 120_000),
    body: form,
  });

  if (!res.ok) throw new OpenAiError(res.status, await res.text());

  const data = (await res.json()) as {
    data?: { b64_json?: string; url?: string }[];
    output_format?: string;
  };
  const b64 = data.data?.[0]?.b64_json;
  // A URL instead of bytes would be useless here: the app's CSP allows images
  // from `self`, `data:` and `blob:` only, so a temporary model-hosted URL could
  // never be displayed. Treat it as a failure rather than pass it on.
  if (!b64) throw new OpenAiError(502, 'Image response carried no image data.');

  const format = data.output_format === 'jpeg' ? 'jpeg' : (data.output_format ?? 'png');
  return {
    bytes: Buffer.from(b64, 'base64'),
    contentType: `image/${format}`,
    model: config.deployment,
  };
}

/** `text.format` values we use. `json_schema` is the strict, validated one. */
export type ResponseFormat =
  | { type: 'json_object' }
  | { type: 'json_schema'; name: string; strict: true; schema: Record<string, unknown> };

/**
 * Server-side tools the model may call while producing a response.
 *
 * `web_search` runs Bing inside the service, so it needs no separate Grounding
 * with Bing resource — which matters, because that resource cannot be deployed
 * on credit-based subscriptions at all.
 */
export type ResponsesTool = {
  type: 'web_search';
  /** How much retrieved page context is fed to the model. Defaults to medium. */
  search_context_size?: 'low' | 'medium' | 'high';
};

export interface ResponsesRequest {
  system: string;
  user: string;
  /** Omitted for plain-text answers, which is what the tool-using calls want. */
  format?: ResponseFormat;
  temperature?: number;
  /** Overrides the configured deployment. */
  model?: string;
  timeoutMs?: number;
  tools?: ResponsesTool[];
  /** `required` forces the tool to run rather than letting the model answer from memory. */
  toolChoice?: 'auto' | 'required';
}

/**
 * A source the model was shown, as reported by the service.
 *
 * These are the only trustworthy URLs in a response. Prose the model writes
 * around them may contain plausible-looking addresses it invented; a citation
 * is a page the search index actually returned.
 */
export interface UrlCitation {
  url: string;
  title: string;
}

export interface ResponsesResult {
  /** Raw assistant text. With a json_schema format this is a JSON document. */
  text: string;
  /** The deployment that actually served the request. */
  model: string;
  /** Sources annotated on the answer, in the order they appear. */
  citations: UrlCitation[];
}

interface ResponsesPayload {
  output?: {
    type?: string;
    content?: {
      type?: string;
      text?: string;
      annotations?: { type?: string; url?: string; title?: string }[];
    }[];
  }[];
}

/**
 * Pulls the assistant text out of a Responses payload. The `output` array can
 * carry non-message items (reasoning, tool calls), so select on type rather
 * than assuming `output[0]`.
 */
export function extractOutputText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const payload = data as ResponsesPayload;
  if (!Array.isArray(payload.output)) return '';
  return payload.output
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('');
}

/**
 * Pulls the cited sources out of a Responses payload.
 *
 * Deduplicated on URL, because the model cites the same page once per sentence
 * that leans on it and the caller wants a list of pages, not of mentions.
 */
export function extractUrlCitations(data: unknown): UrlCitation[] {
  if (typeof data !== 'object' || data === null) return [];
  const payload = data as ResponsesPayload;
  if (!Array.isArray(payload.output)) return [];

  const seen = new Set<string>();
  return payload.output
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .flatMap((part) => part.annotations ?? [])
    .flatMap((annotation) => {
      if (annotation.type !== 'url_citation') return [];
      const { url, title } = annotation;
      if (typeof url !== 'string' || url.length === 0) return [];
      if (seen.has(url)) return [];
      seen.add(url);
      return [{ url, title: typeof title === 'string' ? title : '' }];
    });
}

export class OpenAiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Azure OpenAI returned ${status}: ${body}`);
    this.name = 'OpenAiError';
  }
}

export async function callResponses(
  config: OpenAiConfig,
  request: ResponsesRequest,
): Promise<ResponsesResult> {
  const model = request.model || config.deployment;
  const res = await fetch(`${config.endpoint}/openai/v1/responses`, {
    method: 'POST',
    headers: { 'api-key': config.key, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(request.timeoutMs ?? 30_000),
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      ...(request.format ? { text: { format: request.format } } : {}),
      ...(request.tools ? { tools: request.tools } : {}),
      ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
      temperature: request.temperature ?? 0,
      // Bag text and taste history are the user's data; don't leave copies in
      // the service-side response store.
      store: false,
    }),
  });

  if (!res.ok) throw new OpenAiError(res.status, await res.text());
  const data: unknown = await res.json();
  return { text: extractOutputText(data), model, citations: extractUrlCitations(data) };
}

/** Parses model output that is expected to be JSON, returning undefined if it is not. */
export function parseJsonOutput(text: string): unknown {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return undefined;
  }
}
