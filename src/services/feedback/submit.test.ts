import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendFeedback } from './submit';
import type { FeedbackDiagnostics } from './diagnostics';

const diagnostics: FeedbackDiagnostics = {
  appVersion: '0.1.0',
  route: '/add',
  display: 'Browser tab',
  userAgent: 'Chrome on Windows',
  signedIn: false,
  syncState: 'disabled',
};

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendFeedback', () => {
  it('reports the issue it created, so the sender can follow it', async () => {
    mockFetch(201, { url: 'https://github.com/x/y/issues/9', number: 9 });
    await expect(sendFeedback({ message: 'hi', category: 'bug', diagnostics })).resolves.toEqual({
      kind: 'filed',
      url: 'https://github.com/x/y/issues/9',
      number: 9,
    });
  });

  it('omits an absent category rather than sending an empty one', async () => {
    const fetchMock = mockFetch(201, { url: 'u', number: 1 });
    await sendFeedback({ message: 'hi', category: undefined, diagnostics });
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect('category' in sent).toBe(false);
    expect(sent['message']).toBe('hi');
  });

  // Each of these needs different words in the UI, which is the reason this
  // client does not simply throw on every non-2xx like the AI client does.
  it('tells an unconfigured deployment apart from a broken one', async () => {
    mockFetch(503, { error: 'nope', fallbackUrl: 'https://github.com/x/y/issues/new' });
    await expect(
      sendFeedback({ message: 'hi', category: undefined, diagnostics }),
    ).resolves.toEqual({ kind: 'unconfigured', fallbackUrl: 'https://github.com/x/y/issues/new' });
  });

  it('tells a rate limit apart from a failure', async () => {
    mockFetch(429, {});
    await expect(
      sendFeedback({ message: 'hi', category: undefined, diagnostics }),
    ).resolves.toMatchObject({ kind: 'rate-limited' });
  });

  it('surfaces the server’s reason when it has one', async () => {
    mockFetch(400, { error: 'A message is required' });
    await expect(
      sendFeedback({ message: 'hi', category: undefined, diagnostics }),
    ).resolves.toEqual({ kind: 'failed', message: 'A message is required' });
  });

  it('treats a 2xx that describes no issue as a failure, not a success', async () => {
    mockFetch(201, { ok: true });
    await expect(
      sendFeedback({ message: 'hi', category: undefined, diagnostics }),
    ).resolves.toMatchObject({ kind: 'failed' });
  });

  it('does not throw at the caller when the network is gone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(
      sendFeedback({ message: 'hi', category: undefined, diagnostics }),
    ).resolves.toMatchObject({ kind: 'failed' });
  });
});
