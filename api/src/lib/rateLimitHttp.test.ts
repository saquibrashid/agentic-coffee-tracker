import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest, InvocationContext } from '@azure/functions';

import { resetRateLimitsForTests } from './rateLimit.js';
import { budgetKey, enforceRateLimit } from './rateLimitHttp.js';

const CONFIG = { capacity: 2, refillPerSecond: 1 };

function request(principal?: string): HttpRequest {
  const headers = new Map<string, string>();
  if (principal !== undefined) headers.set('x-ms-client-principal', principal);
  return {
    headers: { get: (name: string) => headers.get(name) ?? null },
  } as unknown as HttpRequest;
}

function principalHeader(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function context(): InvocationContext {
  return { warn: vi.fn(), log: vi.fn(), error: vi.fn() } as unknown as InvocationContext;
}

beforeEach(() => {
  resetRateLimitsForTests();
});

describe('budgetKey', () => {
  it('charges a signed-in caller their own bucket', () => {
    expect(budgetKey(request(principalHeader({ userId: 'alice' })), 'parse')).toBe('parse:alice');
  });

  it('namespaces by endpoint so one budget cannot starve another', () => {
    const req = request(principalHeader({ userId: 'alice' }));
    // Enrichment calls search, then scrape, then parse for a single coffee. A
    // shared bucket would make one import exhaust three endpoints at once.
    expect(budgetKey(req, 'search')).not.toBe(budgetKey(req, 'scrape'));
  });

  it('falls back to a shared bucket when the front door sent no principal', () => {
    expect(budgetKey(request(), 'parse')).toBe('parse:anonymous');
  });

  it('treats a malformed principal as absent rather than failing the request', () => {
    // Rejecting here would turn a garbled header into an outage, and this
    // function does not authenticate anybody.
    expect(budgetKey(request('not-base64-json'), 'parse')).toBe('parse:anonymous');
  });

  it('treats a principal with no userId as anonymous', () => {
    expect(budgetKey(request(principalHeader({ identityProvider: 'aad' })), 'parse')).toBe(
      'parse:anonymous',
    );
  });
});

describe('enforceRateLimit', () => {
  const options = { name: 'parse', config: CONFIG, message: 'Too many labels at once.' };

  it('returns null while the caller is within budget', () => {
    expect(enforceRateLimit(request(), context(), options)).toBeNull();
  });

  it('refuses with a 429 once the burst is spent', () => {
    const req = request();
    const ctx = context();
    for (let i = 0; i < CONFIG.capacity; i++) {
      expect(enforceRateLimit(req, ctx, options)).toBeNull();
    }

    const refused = enforceRateLimit(req, ctx, options);
    expect(refused?.status).toBe(429);
  });

  it('always sets retry-after', () => {
    const req = request();
    const ctx = context();
    for (let i = 0; i < CONFIG.capacity; i++) enforceRateLimit(req, ctx, options);

    // Without it a client cannot tell "wait a second" from "wait ten minutes",
    // so it either abandons work that would have succeeded or retries in a
    // tight loop — the exact behaviour the limit exists to stop.
    const headers = enforceRateLimit(req, ctx, options)?.headers as Record<string, string>;
    expect(Number(headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('explains itself in the body rather than returning an empty 429', () => {
    const req = request();
    const ctx = context();
    for (let i = 0; i < CONFIG.capacity; i++) enforceRateLimit(req, ctx, options);

    const refused = enforceRateLimit(req, ctx, options);
    const body = JSON.parse(refused?.body as string) as { error?: string };
    expect(body.error).toBe(options.message);
  });

  it('does not let one caller exhaust another caller', () => {
    const alice = request(principalHeader({ userId: 'alice' }));
    const bob = request(principalHeader({ userId: 'bob' }));
    const ctx = context();
    for (let i = 0; i < CONFIG.capacity; i++) enforceRateLimit(alice, ctx, options);

    expect(enforceRateLimit(alice, ctx, options)?.status).toBe(429);
    expect(enforceRateLimit(bob, ctx, options)).toBeNull();
  });

  it('does not let one endpoint exhaust another', () => {
    const req = request();
    const ctx = context();
    for (let i = 0; i < CONFIG.capacity; i++) enforceRateLimit(req, ctx, options);

    expect(enforceRateLimit(req, ctx, { ...options, name: 'scrape' })).toBeNull();
  });

  it('logs a warning so a limit that fires in production is visible', () => {
    const req = request();
    const warn = vi.fn();
    const ctx = { warn, log: vi.fn(), error: vi.fn() } as unknown as InvocationContext;
    for (let i = 0; i < CONFIG.capacity; i++) enforceRateLimit(req, ctx, options);
    enforceRateLimit(req, ctx, options);

    // A silent refusal looks identical to a bug report of "it just stopped
    // working", so the operator needs a breadcrumb.
    expect(warn).toHaveBeenCalled();
  });
});
