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
 * Auth is either the Function App's managed identity or an `api-key` header,
 * decided by whether a key was configured — see `openaiAuth.ts`. Keys, when
 * used, are injected as Key Vault references, so they never sit in the deployed
 * configuration in plaintext.
 */

import { recordUsage, withModelSpan } from './telemetry.js';
import { authHeaders } from './openaiAuth.js';

export interface OpenAiConfig {
  endpoint: string;
  deployment: string;
  /**
   * Absent on the provisioned path, where the managed identity is used instead.
   * Present only for a bring-your-own account this deployment cannot grant
   * itself a role on.
   */
  key?: string;
}

/**
 * Returns null when the resource is not configured, which puts callers in mock
 * mode.
 *
 * Note the key is deliberately *not* required. Requiring it was correct while
 * it was the only way to authenticate; now its absence selects the identity
 * instead, and demanding it would make the more secure configuration look like
 * an unconfigured one and silently drop every endpoint into mock mode.
 */
export function getOpenAiConfig(): OpenAiConfig | null {
  const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
  const key = process.env['AZURE_OPENAI_KEY'];
  const deployment = process.env['AZURE_OPENAI_DEPLOYMENT'];
  if (!endpoint || !deployment) return null;
  return { endpoint: endpoint.replace(/\/$/, ''), deployment, ...(key ? { key } : {}) };
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
 *
 * `function` is ours: the service does not run it, it asks us to and waits for
 * the result. That is the difference the agent loop is built on — see
 * `agent.ts`.
 */
export type ResponsesTool =
  | {
      type: 'web_search';
      /** How much retrieved page context is fed to the model. Defaults to medium. */
      search_context_size?: 'low' | 'medium' | 'high';
    }
  | {
      type: 'function';
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      /** Same guarantee as `json_schema` strict: arguments match the schema. */
      strict?: boolean;
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
  /**
   * What the call cost. Reported by every caller so the pipeline's spend is as
   * visible as the agent's — without it the two paths in
   * `specs/agentic-backend.md` §7 could not be compared on cost at all.
   */
  usage: TokenUsage;
}

/**
 * An item in the conversation: a message, a tool call the model made, or the
 * result we handed back. Deliberately untyped — these are echoed back to the
 * service verbatim, and narrowing them here would mean re-describing a wire
 * format we do not own and would have to chase every time it grows.
 */
export type ConversationItem = Record<string, unknown>;

export interface TurnRequest {
  input: ConversationItem[];
  format?: ResponseFormat;
  temperature?: number;
  model?: string;
  timeoutMs?: number;
  tools?: ResponsesTool[];
  toolChoice?: 'auto' | 'required';
}

export interface TurnResult extends ResponsesResult {
  /** Empty when the model answered rather than asking for a tool. */
  toolCalls: RequestedToolCall[];
  usage: TokenUsage;
  /**
   * The raw output items, for appending to the next turn's input. The service
   * requires its own tool-call items back alongside our results.
   */
  outputItems: ConversationItem[];
}

interface ResponsesPayload {
  output?: {
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    content?: {
      type?: string;
      text?: string;
      annotations?: { type?: string; url?: string; title?: string }[];
    }[];
  }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * What a turn cost. The agent loop budgets on this, so it has to come from the
 * service rather than from a local estimate: a tool-using turn silently
 * includes whatever the tool put into context, which is exactly the spend an
 * estimate based on our own prompt would miss.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function extractUsage(data: unknown): TokenUsage {
  if (typeof data !== 'object' || data === null) return { inputTokens: 0, outputTokens: 0 };
  const usage = (data as ResponsesPayload).usage;
  return {
    inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0,
    outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0,
  };
}

/** A tool call the model is waiting on us to run. */
export interface RequestedToolCall {
  callId: string;
  name: string;
  /** Raw JSON string. Left unparsed here so the caller decides what invalid means. */
  arguments: string;
}

export function extractToolCalls(data: unknown): RequestedToolCall[] {
  if (typeof data !== 'object' || data === null) return [];
  const payload = data as ResponsesPayload;
  if (!Array.isArray(payload.output)) return [];
  return payload.output.flatMap((item) => {
    if (item.type !== 'function_call') return [];
    if (typeof item.call_id !== 'string' || typeof item.name !== 'string') return [];
    return [
      {
        callId: item.call_id,
        name: item.name,
        arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
      },
    ];
  });
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

/**
 * One turn of a conversation, with the input given as raw items.
 *
 * `callResponses` below builds a fresh system+user pair every time, which is
 * all a single-shot completion needs. A tool loop cannot work that way: each
 * turn has to carry the model's own previous tool calls and their results, or
 * the model re-requests work it has already had done. This is the primitive
 * that makes that possible; `callResponses` is now a thin wrapper over it so
 * there is still only one place that knows how to talk to the service.
 */
export async function callResponsesTurn(
  config: OpenAiConfig,
  request: TurnRequest,
): Promise<TurnResult> {
  const model = request.model || config.deployment;
  // Every model call in the BFF reaches the service through here, including the
  // agent loop's turns, so one span here covers all of them and none can be
  // added later that quietly escapes measurement.
  return withModelSpan(model, async (span) => {
    const auth = await authHeaders(config.key);
    const res = await fetch(`${config.endpoint}/openai/v1/responses`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(request.timeoutMs ?? 30_000),
      body: JSON.stringify({
        model,
        input: request.input,
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
    const payload = data as { output?: ConversationItem[] };
    const usage = extractUsage(data);
    recordUsage(span, usage, model);
    return {
      text: extractOutputText(data),
      model,
      citations: extractUrlCitations(data),
      toolCalls: extractToolCalls(data),
      usage,
      outputItems: Array.isArray(payload.output) ? payload.output : [],
    };
  });
}

export async function callResponses(
  config: OpenAiConfig,
  request: ResponsesRequest,
): Promise<ResponsesResult> {
  const { text, model, citations, usage } = await callResponsesTurn(config, {
    ...request,
    input: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
  });
  return { text, model, citations, usage };
}

/** Parses model output that is expected to be JSON, returning undefined if it is not. */
export function parseJsonOutput(text: string): unknown {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return undefined;
  }
}
