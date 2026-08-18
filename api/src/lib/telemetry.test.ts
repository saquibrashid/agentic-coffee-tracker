import { context, trace } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { beforeEach, describe, expect, it } from 'vitest';

import { COFFEE, GEN_AI, recordUsage, withModelSpan, withSpan, withToolSpan } from './telemetry.js';

/**
 * These tests deliberately run against the **no-op tracer**, which is what the
 * test suite and an unconfigured local host get.
 *
 * That is the property worth protecting: instrumentation must never be the
 * reason something breaks. Nothing here is exported anywhere, no connection
 * string is set, and every assertion is that the wrapped code behaves exactly
 * as it would uninstrumented.
 */
describe('telemetry', () => {
  describe('span helpers are transparent', () => {
    it('returns the wrapped value', async () => {
      const result = await withSpan('test', {}, () => Promise.resolve(42));
      expect(result).toBe(42);
    });

    it('rethrows the original error, unwrapped', async () => {
      const boom = new Error('boom');
      await expect(withSpan('test', {}, () => Promise.reject(boom))).rejects.toBe(boom);
    });

    it('survives a non-Error rejection', async () => {
      // `recordException` and `setStatus` both want an Error. A string
      // rejection must not become a TypeError inside the instrumentation,
      // which would replace the real failure with our own.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- rejecting a non-Error is the case under test
      await expect(withSpan('test', {}, () => Promise.reject('nope'))).rejects.toBe('nope');
    });

    it('works without a configured exporter', async () => {
      // The no-op tracer is what an unconfigured host gets. If this threw, every
      // AI endpoint would fail locally the moment it was instrumented.
      await expect(withModelSpan('gpt-5.4-mini', () => Promise.resolve('ok'))).resolves.toBe('ok');
      await expect(withToolSpan('fetch_page', {}, () => Promise.resolve('ok'))).resolves.toBe('ok');
    });

    it('lets the body record attributes without a live span', async () => {
      const result = await withToolSpan('search_roaster_store', {}, (span) => {
        span.setAttribute(COFFEE.toolOutcome, 'found');
        recordUsage(span, { inputTokens: 10, outputTokens: 2 }, 'gpt-5.4-mini');
        return Promise.resolve('done');
      });
      expect(result).toBe('done');
    });
  });

  describe('attribute names match the GenAI conventions', () => {
    // Pinned as literals rather than referenced, so a rename has to be a
    // deliberate edit here. Foundry Agent Insights and the App Insights Agents
    // view select on these exact strings; a typo produces spans that are
    // technically valid and invisible to the tooling, which is the failure
    // mode hardest to notice.
    it('uses the documented gen_ai names', () => {
      expect(GEN_AI.operationName).toBe('gen_ai.operation.name');
      expect(GEN_AI.providerName).toBe('gen_ai.provider.name');
      expect(GEN_AI.requestModel).toBe('gen_ai.request.model');
      expect(GEN_AI.responseModel).toBe('gen_ai.response.model');
      expect(GEN_AI.inputTokens).toBe('gen_ai.usage.input_tokens');
      expect(GEN_AI.outputTokens).toBe('gen_ai.usage.output_tokens');
      expect(GEN_AI.toolName).toBe('gen_ai.tool.name');
    });

    it('keeps our own attributes in a namespace the conventions cannot claim', () => {
      for (const name of Object.values(COFFEE)) {
        expect(name.startsWith('coffee.')).toBe(true);
      }
    });
  });

  describe('recorded spans', () => {
    // A tiny in-memory tracer provider, so the shape of what we emit is
    // asserted rather than assumed. The conventions are only useful if the
    // spans actually carry them.
    const spans: ReadableSpan[] = [];

    beforeEach(() => {
      spans.length = 0;
    });

    it('names a model span "chat {model}" and carries the request model', async () => {
      const recorded = await captureSpans(spans, () =>
        withModelSpan('gpt-5.4-mini', (span) => {
          recordUsage(span, { inputTokens: 100, outputTokens: 20 }, 'gpt-5.4-mini');
          return Promise.resolve(null);
        }),
      );

      const span = recorded[0];
      expect(span?.name).toBe('chat gpt-5.4-mini');
      expect(span?.attributes[GEN_AI.operationName]).toBe('chat');
      expect(span?.attributes[GEN_AI.requestModel]).toBe('gpt-5.4-mini');
      expect(span?.attributes[GEN_AI.inputTokens]).toBe(100);
      expect(span?.attributes[GEN_AI.outputTokens]).toBe(20);
    });

    it('names a tool span "execute_tool {name}"', async () => {
      const recorded = await captureSpans(spans, () =>
        withToolSpan('fetch_page', { 'coffee.store.domain': 'onyx.com' }, () =>
          Promise.resolve(null),
        ),
      );

      const span = recorded[0];
      expect(span?.name).toBe('execute_tool fetch_page');
      expect(span?.attributes[GEN_AI.operationName]).toBe('execute_tool');
      expect(span?.attributes[GEN_AI.toolName]).toBe('fetch_page');
      expect(span?.attributes['coffee.store.domain']).toBe('onyx.com');
    });

    it('nests tool spans under the enclosing workflow span', async () => {
      // The reason for startActiveSpan. Without the parent link a single
      // enrichment is a scatter of unrelated spans, and "which step failed"
      // stops being answerable.
      const recorded = await captureSpans(spans, () =>
        withSpan('enrich.search', {}, () =>
          withToolSpan('search_roaster_store', {}, () => Promise.resolve(null)),
        ),
      );

      const parent = recorded.find((s) => s.name === 'enrich.search');
      const child = recorded.find((s) => s.name === 'execute_tool search_roaster_store');
      expect(parent).toBeDefined();
      expect(child).toBeDefined();
      // Asserted explicitly: comparing two undefineds would pass while every
      // span was in fact orphaned at the root.
      expect(child?.parentSpanContext?.spanId).toBeTypeOf('string');
      expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
      expect(child?.spanContext().traceId).toBe(parent?.spanContext().traceId);
    });

    it('marks a span that threw as an error', async () => {
      const recorded = await captureSpans(spans, async () => {
        await expect(
          withToolSpan('fetch_page', {}, () => Promise.reject(new Error('unreachable'))),
        ).rejects.toThrow('unreachable');
      });

      // 2 is SpanStatusCode.ERROR. A failed step has to be distinguishable
      // from a step that found nothing, or the failure rate is unreadable.
      expect(recorded[0]?.status.code).toBe(2);
      expect(recorded[0]?.status.message).toBe('unreachable');
    });
  });
});

/**
 * Installs a real tracer provider for the duration of one call, collecting
 * finished spans.
 *
 * Registered and torn down per test rather than globally, so the rest of the
 * suite keeps the no-op tracer and stays representative of production-when-
 * unconfigured.
 */
async function captureSpans(sink: ReadableSpan[], fn: () => Promise<unknown>) {
  const { BasicTracerProvider, SimpleSpanProcessor, InMemorySpanExporter } =
    await import('@opentelemetry/sdk-trace-base');
  const { AsyncLocalStorageContextManager } = await import('@opentelemetry/context-async-hooks');

  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  // Without a context manager, `startActiveSpan` cannot carry the parent across
  // an `await`, and the nesting assertion below would pass vacuously with every
  // span orphaned at the root.
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);

  try {
    await fn();
  } finally {
    await provider.forceFlush();
    sink.push(...exporter.getFinishedSpans());
    contextManager.disable();
    trace.disable();
    context.disable();
  }
  return sink;
}
