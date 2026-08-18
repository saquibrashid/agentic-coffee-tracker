/**
 * OpenTelemetry spans for the AI paths, in the GenAI semantic conventions.
 *
 * Why conventions rather than our own log lines: Foundry Agent Insights and the
 * App Insights "Agents" view read `gen_ai.*` spans out of Application Insights.
 * Emitting the same vocabulary means the tooling works on the pipeline as it
 * stands, without adopting a hosted agent runtime — see specs/observability.md.
 *
 * The conventions are still marked Development upstream, so every attribute
 * name lives in `GEN_AI` below. When they stabilise and rename something, this
 * is the one file that changes.
 *
 * **Everything here is a no-op until `startTelemetry()` finds a connection
 * string.** The OTel API ships a no-op tracer by default, so unconfigured local
 * runs and the test suite create spans that cost a function call and vanish.
 * That is deliberate: instrumentation that has to be guarded at every call site
 * stops being added.
 */

import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';

// Side-effecting import: starts Azure Monitor when a connection string is
// present. Placed here rather than in an entry point because every span in the
// app is created through this module, so this cannot be bypassed.
import '../bootstrap.js';

/**
 * GenAI semantic convention attribute names.
 *
 * https://github.com/open-telemetry/semantic-conventions-genai
 */
export const GEN_AI = {
  operationName: 'gen_ai.operation.name',
  providerName: 'gen_ai.provider.name',
  requestModel: 'gen_ai.request.model',
  responseModel: 'gen_ai.response.model',
  inputTokens: 'gen_ai.usage.input_tokens',
  outputTokens: 'gen_ai.usage.output_tokens',
  toolName: 'gen_ai.tool.name',
} as const;

/**
 * Attributes that are ours, not the conventions'.
 *
 * Namespaced so a future convention cannot collide with them, and so a query
 * can tell "what the standard says" from "what this app decided".
 *
 * `outcome` on the enrichment span is the one that matters most: it is the
 * server-side name for the client's `NoCandidatesError`, and the number issue
 * #208 turns on.
 */
export const COFFEE = {
  enrichOutcome: 'coffee.enrich.outcome',
  enrichProvider: 'coffee.enrich.provider',
  enrichResultCount: 'coffee.enrich.result_count',
  enrichDomainsTried: 'coffee.enrich.domains_tried',
  toolOutcome: 'coffee.tool.outcome',
  pageBytes: 'coffee.page.text_length',
} as const;

/** How an enrichment lookup ended. */
export type EnrichOutcome =
  /** A product page was found. */
  | 'found'
  /** Nothing found anywhere. This is `NoCandidatesError` on the client. */
  | 'no-candidates'
  /** The endpoint ran without a model configured and returned its fixture. */
  | 'mock';

const TRACER_NAME = 'coffee-app.api';

export function getTracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Runs `fn` inside a span, recording failures and always ending the span.
 *
 * The span is passed in so the body can attach what it only learns by running —
 * the response model, the token usage, whether anything was found. Attributes
 * known up front go in `attributes` instead.
 *
 * Uses `startActiveSpan`, so anything this calls nests underneath without
 * having to thread a parent through every signature. That is what makes a
 * single enrichment readable as one trace rather than a scatter of events.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return getTracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      // Record the failure on the span before rethrowing: the caller's own
      // error handling is unchanged, but the trace now says why it ended.
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * A span for one model call.
 *
 * Named `chat {model}` per the conventions — the operation and its target, so
 * a trace list is readable without opening each span.
 */
export async function withModelSpan<T>(
  requestModel: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(
    `chat ${requestModel}`,
    {
      [GEN_AI.operationName]: 'chat',
      [GEN_AI.providerName]: 'azure.ai.openai',
      [GEN_AI.requestModel]: requestModel,
    },
    fn,
  );
}

/**
 * A span for one tool execution — a store search, a page fetch, a paid lookup.
 *
 * These are the steps the fallback ladder runs, and `execute_tool` is what the
 * conventions call them whether a model chose to run them or a `for` loop did.
 * Recording both the same way is the point: it is what lets the pipeline and
 * the agent be compared in the same query.
 */
export async function withToolSpan<T>(
  toolName: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(
    `execute_tool ${toolName}`,
    {
      [GEN_AI.operationName]: 'execute_tool',
      [GEN_AI.toolName]: toolName,
      ...attributes,
    },
    fn,
  );
}

/** Records token usage on a span in the conventions' names. */
export function recordUsage(
  span: Span,
  usage: { inputTokens: number; outputTokens: number },
  responseModel?: string,
): void {
  span.setAttribute(GEN_AI.inputTokens, usage.inputTokens);
  span.setAttribute(GEN_AI.outputTokens, usage.outputTokens);
  if (responseModel) span.setAttribute(GEN_AI.responseModel, responseModel);
}
