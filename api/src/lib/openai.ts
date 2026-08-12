/**
 * Thin client for the Azure OpenAI **v1 API**.
 *
 * `POST {endpoint}/openai/v1/responses` is the current surface and needs no
 * dated `api-version`, unlike the older `/openai/deployments/{d}/chat/completions`
 * route it replaces. Strict structured outputs are supported here via
 * `text.format`, which the schema-validated endpoints depend on.
 *
 * Image generation does *not* live here: it runs on a MAI model on a separate
 * resource with its own host and route — see `imageModel.ts`.
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
