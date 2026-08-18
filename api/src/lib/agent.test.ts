import { describe, expect, it, vi } from 'vitest';

import {
  AgentFailedError,
  runEnrichAgent,
  type AgentBudget,
  type AgentDeps,
  type FetchedPage,
  type StoreHit,
} from './agent.js';
import type { ConversationItem, OpenAiConfig, TurnResult } from './openai.js';

const CONFIG: OpenAiConfig = {
  endpoint: 'https://example.invalid',
  key: 'k',
  deployment: 'test-model',
};

const BEAN = {
  roaster: 'Onyx',
  name: 'Southern Weather',
  origins: [{ country: 'Ethiopia', region: null, farm: null, producer: null, percentage: null }],
  process: 'washed',
  roastLevel: 'medium',
  tastingNotes: ['cocoa'],
  roastDate: null,
  varietals: [],
  elevationMeters: null,
  roasterDescription: null,
  confidence: 0.9,
};

/**
 * A model that plays a fixed script, one entry per turn.
 *
 * Scripting the model is the only way to assert on budgets: a real one would
 * decide for itself how many steps to take, which is precisely the variable
 * these tests are pinning down.
 */
function scriptedModel(script: Partial<TurnResult>[]) {
  const seen: ConversationItem[][] = [];
  let turn = 0;
  const callTurn: AgentDeps['callTurn'] = (_config, request) => {
    seen.push([...request.input]);
    const step = script[Math.min(turn, script.length - 1)] ?? {};
    turn += 1;
    return Promise.resolve({
      text: '',
      model: 'test-model',
      citations: [],
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 10 },
      outputItems: [],
      ...step,
    } satisfies TurnResult);
  };
  return { callTurn, seen, requests: () => turn };
}

function toolCall(name: string, args: unknown, callId = `c${Math.random()}`) {
  return { callId, name, arguments: JSON.stringify(args) };
}

/** A turn in which the model asks for one tool. */
function asks(name: string, args: unknown): Partial<TurnResult> {
  const call = toolCall(name, args);
  return {
    toolCalls: [call],
    outputItems: [{ type: 'function_call', call_id: call.callId, name, arguments: call.arguments }],
  };
}

/** A turn in which the model answers. */
function answers(bean: unknown = BEAN): Partial<TurnResult> {
  return { text: JSON.stringify(bean), toolCalls: [] };
}

function deps(overrides: Partial<AgentDeps> = {}): Partial<AgentDeps> {
  return {
    fetchPage: () =>
      Promise.resolve({ text: 'x'.repeat(500), finalUrl: 'https://onyx.com/p/sw' } as FetchedPage),
    searchStore: () =>
      Promise.resolve([
        { url: 'https://onyx.com/p/sw', title: 'Southern Weather', snippet: '' },
      ] as StoreHit[]),
    searchWeb: () => Promise.resolve({ hits: [] as StoreHit[] }),
    log: vi.fn(),
    ...overrides,
  };
}

const INPUT = { roaster: 'Onyx', name: 'Southern Weather' };

/** Clock that advances a fixed amount per reading, for the deadline tests. */
function clock(stepMs: number) {
  let t = 0;
  return () => {
    const now = t;
    t += stepMs;
    return now;
  };
}

describe('runEnrichAgent', () => {
  it('answers without calling a tool when the model already knows', async () => {
    const model = scriptedModel([answers()]);
    const result = await runEnrichAgent(CONFIG, INPUT, deps({ callTurn: model.callTurn }));

    expect(result.parsed.name).toBe('Southern Weather');
    expect(result.trace.stopReason).toBe('answered');
    expect(result.trace.steps).toBe(0);
    expect(model.requests()).toBe(1);
  });

  it('feeds a tool result back to the model and answers on the next turn', async () => {
    const model = scriptedModel([
      asks('search_roaster_store', { domain: 'onyx.com', query: 'Southern Weather' }),
      answers(),
    ]);
    const result = await runEnrichAgent(CONFIG, INPUT, deps({ callTurn: model.callTurn }));

    expect(result.trace.steps).toBe(1);
    expect(result.trace.toolEvents).toHaveLength(1);
    expect(result.trace.toolEvents[0]?.ok).toBe(true);

    // The second request must carry both the model's own call and our result,
    // or the model re-requests work it has already had done.
    const second = model.seen[1] ?? [];
    expect(second.some((item) => item['type'] === 'function_call')).toBe(true);
    const output = second.find((item) => item['type'] === 'function_call_output');
    expect(output).toBeDefined();
    expect(String(output?.['output'])).toContain('onyx.com/p/sw');
  });

  it('records the page a fetch settled on as the source', async () => {
    const model = scriptedModel([asks('fetch_page', { url: 'https://onyx.com/p/sw' }), answers()]);
    const result = await runEnrichAgent(CONFIG, INPUT, deps({ callTurn: model.callTurn }));

    expect(result.sourceUrl).toBe('https://onyx.com/p/sw');
  });

  describe('budgets', () => {
    const budget = (over: Partial<AgentBudget>): AgentBudget => ({
      maxSteps: 6,
      maxTokens: 60_000,
      maxPaidSearches: 2,
      deadlineMs: 60_000,
      ...over,
    });

    it('stops a model that would loop forever, and still answers', async () => {
      // Every turn asks for another tool, so without a cap this never returns.
      // The third entry is what the forced final turn replies with.
      const model = scriptedModel([
        asks('search_roaster_store', { domain: 'a.com', query: 'x' }),
        asks('search_roaster_store', { domain: 'b.com', query: 'x' }),
        answers(),
      ]);
      const result = await runEnrichAgent(
        CONFIG,
        INPUT,
        deps({ callTurn: model.callTurn }),
        budget({ maxSteps: 2 }),
      );

      expect(result.trace.stopReason).toBe('step-cap');
      expect(result.trace.steps).toBe(2);
      // Two tool turns plus the forced answer, and no more.
      expect(model.requests()).toBe(3);
    });

    it('withdraws the tools on the forced final turn', async () => {
      const requests: { tools?: unknown }[] = [];
      const inner = scriptedModel([
        asks('search_roaster_store', { domain: 'a.com', query: 'x' }),
        answers(),
      ]);
      const callTurn: AgentDeps['callTurn'] = (config, request) => {
        requests.push(request);
        return inner.callTurn(config, request);
      };

      await runEnrichAgent(CONFIG, INPUT, deps({ callTurn }), budget({ maxSteps: 1 }));

      expect(requests[0]?.tools).toBeDefined();
      // Leaving the tools visible would invite a call we cannot act on, and we
      // would have paid for the turn regardless.
      expect(requests[1]?.tools).toBeUndefined();
    });

    it('stops on the token budget even when steps remain', async () => {
      const model = scriptedModel([
        {
          ...asks('search_roaster_store', { domain: 'a.com', query: 'x' }),
          usage: { inputTokens: 900, outputTokens: 200 },
        },
        answers(),
      ]);
      const result = await runEnrichAgent(
        CONFIG,
        INPUT,
        deps({ callTurn: model.callTurn }),
        budget({ maxTokens: 1000 }),
      );

      expect(result.trace.stopReason).toBe('token-budget');
      expect(result.trace.steps).toBe(1);
      expect(result.trace.usage.inputTokens).toBe(1000);
    });

    it('counts tokens spent inside a tool against the budget too', async () => {
      // The paid search runs a model call of its own. Counting only the loop's
      // turns hid most of the cost of the one roaster that needs that search,
      // which is the case the whole comparison turns on.
      const searchWeb = vi
        .fn()
        .mockResolvedValue({ hits: [], usage: { inputTokens: 5_000, outputTokens: 100 } });
      const model = scriptedModel([asks('web_search_product', INPUT), answers()]);

      const result = await runEnrichAgent(
        CONFIG,
        INPUT,
        deps({ callTurn: model.callTurn, searchWeb }),
        budget({ maxTokens: 4_000 }),
      );

      expect(result.trace.usage.inputTokens).toBe(5_200);
      expect(result.trace.stopReason).toBe('token-budget');
    });

    it('stops on the deadline', async () => {
      const model = scriptedModel([
        asks('search_roaster_store', { domain: 'a.com', query: 'x' }),
        answers(),
      ]);
      const result = await runEnrichAgent(
        CONFIG,
        INPUT,
        deps({ callTurn: model.callTurn, now: clock(5_000) }),
        budget({ deadlineMs: 1 }),
      );

      expect(result.trace.stopReason).toBe('deadline');
    });

    it('refuses a paid search past the budget instead of billing for it', async () => {
      const searchWeb = vi.fn().mockResolvedValue({ hits: [] });
      const model = scriptedModel([
        asks('web_search_product', INPUT),
        asks('web_search_product', INPUT),
        answers(),
      ]);
      const result = await runEnrichAgent(
        CONFIG,
        INPUT,
        deps({ callTurn: model.callTurn, searchWeb }),
        budget({ maxPaidSearches: 1 }),
      );

      expect(searchWeb).toHaveBeenCalledTimes(1);
      expect(result.trace.paidSearches).toBe(1);
      expect(result.trace.toolEvents[1]?.ok).toBe(false);
      expect(result.trace.toolEvents[1]?.detail).toBe('budget spent');
    });
  });

  describe('where it is allowed to look', () => {
    it('pins to the roaster domain once a store search finds the coffee', async () => {
      const fetchPage = vi.fn();
      const model = scriptedModel([
        asks('search_roaster_store', { domain: 'onyx.com', query: 'Southern Weather' }),
        asks('fetch_page', { url: 'https://other-roaster.com/p/sw' }),
        answers(),
      ]);
      const result = await runEnrichAgent(
        CONFIG,
        INPUT,
        deps({ callTurn: model.callTurn, fetchPage }),
      );

      expect(fetchPage).not.toHaveBeenCalled();
      expect(result.trace.pinnedDomain).toBe('onyx.com');
      expect(result.trace.toolEvents[1]?.detail).toBe('off-domain other-roaster.com');
    });

    it('allows a subdomain of the pinned store', async () => {
      const fetchPage = vi
        .fn()
        .mockResolvedValue({ text: 'x', finalUrl: 'https://shop.onyx.com/p/sw' });
      const model = scriptedModel([
        asks('search_roaster_store', { domain: 'onyx.com', query: 'Southern Weather' }),
        asks('fetch_page', { url: 'https://shop.onyx.com/p/sw' }),
        answers(),
      ]);
      await runEnrichAgent(CONFIG, INPUT, deps({ callTurn: model.callTurn, fetchPage }));

      expect(fetchPage).toHaveBeenCalledOnce();
    });

    it('refuses a marketplace even before a domain is pinned', async () => {
      const fetchPage = vi.fn();
      const model = scriptedModel([
        asks('fetch_page', { url: 'https://www.amazon.com/dp/B01' }),
        answers(),
      ]);
      const result = await runEnrichAgent(
        CONFIG,
        INPUT,
        deps({ callTurn: model.callTurn, fetchPage }),
      );

      expect(fetchPage).not.toHaveBeenCalled();
      expect(result.trace.toolEvents[0]?.detail).toBe('blocked amazon.com');
    });

    it('does not pin on a store search that found nothing', async () => {
      const fetchPage = vi
        .fn()
        .mockResolvedValue({ text: 'x', finalUrl: 'https://elsewhere.com/p' });
      const model = scriptedModel([
        asks('search_roaster_store', { domain: 'wrong.com', query: 'x' }),
        asks('fetch_page', { url: 'https://elsewhere.com/p' }),
        answers(),
      ]);
      await runEnrichAgent(
        CONFIG,
        INPUT,
        deps({ callTurn: model.callTurn, fetchPage, searchStore: () => Promise.resolve([]) }),
      );

      expect(fetchPage).toHaveBeenCalledOnce();
    });
  });

  describe('failures', () => {
    it('reports a throwing tool to the model rather than ending the run', async () => {
      const model = scriptedModel([
        asks('fetch_page', { url: 'https://onyx.com/p/sw' }),
        answers(),
      ]);
      const result = await runEnrichAgent(
        CONFIG,
        INPUT,
        deps({
          callTurn: model.callTurn,
          fetchPage: () => Promise.reject(new Error('Fetch returned 503')),
        }),
      );

      expect(result.trace.stopReason).toBe('answered');
      expect(result.trace.toolEvents[0]?.ok).toBe(false);
      const output = (model.seen[1] ?? []).find((i) => i['type'] === 'function_call_output');
      expect(String(output?.['output'])).toContain('503');
    });

    it('fails with the trace attached when the answer is not a bean at all', async () => {
      // A partial object would *not* fail: `normalizeParsedBean` backfills the
      // missing keys, so `{roaster:'Onyx'}` validates as a bean of nulls with
      // confidence 0. That is the same leniency `/api/parse` has, and keeping
      // it identical is the point — this guard is for output that is not an
      // object at all, which strict schema mode should already prevent.
      const model = scriptedModel([answers('sorry, I could not find it')]);

      const error = await runEnrichAgent(CONFIG, INPUT, deps({ callTurn: model.callTurn })).catch(
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(AgentFailedError);
      expect((error as AgentFailedError).trace.stopReason).toBe('schema-invalid');
    });

    it('carries the trace through a transport failure', async () => {
      const callTurn = () => Promise.reject(new Error('502 Bad Gateway'));
      const error = await runEnrichAgent(CONFIG, INPUT, deps({ callTurn })).catch(
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(AgentFailedError);
      expect((error as AgentFailedError).trace.steps).toBe(0);
      expect((error as AgentFailedError).message).toContain('502');
    });

    it('does not crash on tool arguments that are not valid JSON', async () => {
      const model = scriptedModel([
        {
          toolCalls: [{ callId: 'c1', name: 'search_roaster_store', arguments: '{not json' }],
          outputItems: [],
        },
        answers(),
      ]);
      const result = await runEnrichAgent(CONFIG, INPUT, deps({ callTurn: model.callTurn }));

      expect(result.trace.toolEvents[0]?.detail).toBe('no domain');
      expect(result.trace.stopReason).toBe('answered');
    });
  });
});
