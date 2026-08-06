import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiTimeoutError, search } from './index';

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

    const pending = search({ roaster: 'Onyx', name: 'Geometry' });
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
});
