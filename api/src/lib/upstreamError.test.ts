import { describe, expect, it, vi } from 'vitest';
import type { InvocationContext } from '@azure/functions';
import { errorResponse } from './http.js';
import { OpenAiError } from './openai.js';
import { ImageModelError } from './imageModel.js';
import { retryAfterSeconds, statusForUpstream, UpstreamError } from './upstreamError.js';

function ctx(): InvocationContext {
  return { error: vi.fn(), warn: vi.fn(), log: vi.fn() } as unknown as InvocationContext;
}

describe('statusForUpstream', () => {
  it('keeps the route status when the failure was ours', () => {
    expect(statusForUpstream(new Error('boom'), 500)).toBe(500);
  });

  it('passes a throttle through, so the caller knows to come back', () => {
    expect(statusForUpstream(new UpstreamError('Azure OpenAI', 429, 'slow down'), 500)).toBe(429);
  });

  it('reports an upstream fault as a dependency being down, not our own crash', () => {
    expect(statusForUpstream(new UpstreamError('Azure OpenAI', 502, 'bad gateway'), 500)).toBe(503);
    expect(statusForUpstream(new UpstreamError('Azure OpenAI', 408, 'timeout'), 500)).toBe(503);
  });

  it('does not blame the caller for a request we got wrong', () => {
    // An upstream 400 means we sent bad input. Answering 400 would tell the app
    // to stop retrying something it never controlled.
    expect(statusForUpstream(new UpstreamError('Azure OpenAI', 400, 'bad request'), 500)).toBe(500);
  });
});

describe('retryAfterSeconds', () => {
  it('reads the delay the provider asked for', () => {
    expect(retryAfterSeconds(new Headers({ 'retry-after': '30' }))).toBe(30);
  });

  it('is absent when the provider did not say', () => {
    expect(retryAfterSeconds(new Headers())).toBeUndefined();
  });

  it('ignores the HTTP-date form rather than guessing against a clock we do not own', () => {
    expect(retryAfterSeconds(new Headers({ 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }))).toBe(
      undefined,
    );
  });
});

describe('errorResponse', () => {
  it('maps a throttled model to 429 even though the route asked for 500', () => {
    const res = errorResponse(ctx(), 500, 'Parse failed', new OpenAiError(429, 'rate limited'));
    expect(res.status).toBe(429);
  });

  it('maps a throttled image model the same way, since every route shares this', () => {
    const res = errorResponse(
      ctx(),
      500,
      'Could not re-shoot that photo',
      new ImageModelError(429, 'rate limited'),
    );
    expect(res.status).toBe(429);
  });

  it('passes the provider Retry-After straight through', () => {
    const res = errorResponse(ctx(), 500, 'Parse failed', new OpenAiError(429, 'rate limited', 42));
    expect(res.headers).toMatchObject({ 'retry-after': '42' });
  });

  it('says nothing about waiting when the provider did not', () => {
    const res = errorResponse(ctx(), 500, 'Parse failed', new OpenAiError(429, 'rate limited'));
    expect(res.headers).not.toHaveProperty('retry-after');
  });

  it('still answers 500 for our own failures', () => {
    const res = errorResponse(ctx(), 500, 'Parse failed', new TypeError('undefined is not a fn'));
    expect(res.status).toBe(500);
  });

  it('never leaks the upstream body, which names our deployment and region', () => {
    const res = errorResponse(
      ctx(),
      500,
      'Parse failed',
      new OpenAiError(429, 'requests to gpt-5.4-mini in eastus2 have exceeded rate limit'),
    );
    expect(res.body).toBe(JSON.stringify({ error: 'Parse failed' }));
  });
});
