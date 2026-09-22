import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiTimeoutError, scrape, search } from './index';

/** A fetch that never answers unless its abort signal fires. */
function hangingFetch(): typeof fetch {
  return vi.fn((_input: unknown, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
  });
}

function jsonFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response),
  );
}

describe('apiPost', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('rejects with ApiTimeoutError when the backend never answers', async () => {
    globalThis.fetch = hangingFetch();

    const pending = scrape({ url: 'https://example.com/coffee' });
    const assertion = expect(pending).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it('does not time out a request that answers in time', async () => {
    globalThis.fetch = jsonFetch(200, { results: [] });

    const pending = search({ roaster: 'Onyx', name: 'Geometry' });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toEqual({ results: [] });
  });

  it('still surfaces HTTP errors as ApiError, not timeouts', async () => {
    globalThis.fetch = jsonFetch(429, { error: 'slow down' });

    const pending = search({ roaster: 'Onyx', name: 'Geometry' });
    const assertion = expect(pending).rejects.toBeInstanceOf(ApiError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  /**
   * Regression for a lookup that could never succeed. `/api/search` walks a
   * ladder of guessed roaster domains, and a dead one costs a full connect
   * timeout before the next is tried — measured at 32s against the deployed API
   * for a roaster whose real store was third in the ladder.
   *
   * Under the default ceiling that is not a slow success but a permanent
   * failure: `ApiTimeoutError` is not an `ApiError`, so `isTerminalEnrichFailure`
   * keeps it retryable and the queue re-runs the same doomed call forever.
   */
  it('gives the slowest lookup a model-length budget rather than the default', async () => {
    globalThis.fetch = hangingFetch();

    const pending = search({ roaster: 'Storyville Coffee Company', name: 'Prologue' });
    const assertion = expect(pending).rejects.toBeInstanceOf(ApiTimeoutError);

    let settled = false;
    void pending.catch(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(40_000);
    await assertion;
  });
});
