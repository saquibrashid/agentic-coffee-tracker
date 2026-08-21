import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccessToken, TokenCredential } from '@azure/identity';

import {
  authHeaders,
  getAccessToken,
  OPENAI_SCOPE,
  setCredentialForTesting,
} from './openaiAuth.js';

const HOUR_MS = 60 * 60 * 1000;

function stubCredential(expiresOnTimestamp: number): {
  credential: TokenCredential;
  getToken: ReturnType<typeof vi.fn>;
} {
  let n = 0;
  const getToken = vi.fn((): Promise<AccessToken> =>
    Promise.resolve({ token: `token-${++n}`, expiresOnTimestamp } as AccessToken),
  );
  return { credential: { getToken }, getToken };
}

afterEach(() => {
  setCredentialForTesting(undefined);
});

describe('getAccessToken', () => {
  it('asks for the Azure AI Services audience, not a per-account URL', async () => {
    const { credential, getToken } = stubCredential(Date.now() + HOUR_MS);
    setCredentialForTesting(credential);

    await getAccessToken();

    expect(getToken).toHaveBeenCalledWith(OPENAI_SCOPE);
  });

  it('reuses a token instead of fetching one per call', async () => {
    const now = Date.now();
    const { credential, getToken } = stubCredential(now + HOUR_MS);
    setCredentialForTesting(credential);

    const first = await getAccessToken(now);
    const second = await getAccessToken(now + 1000);

    expect(second).toBe(first);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('refreshes before expiry rather than at it, so a long call cannot outlive its token', async () => {
    const now = Date.now();
    const expiresOn = now + HOUR_MS;
    const { credential, getToken } = stubCredential(expiresOn);
    setCredentialForTesting(credential);

    await getAccessToken(now);
    // Still valid for another minute, but inside the safety margin.
    await getAccessToken(expiresOn - 60 * 1000);

    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('throws rather than sending an empty bearer when the identity returns nothing', async () => {
    const getToken = vi.fn(() => Promise.resolve(null));
    setCredentialForTesting({ getToken });

    await expect(getAccessToken()).rejects.toThrow(/no token/i);
  });
});

describe('authHeaders', () => {
  it('uses the key when one is configured, without touching the identity', async () => {
    const { credential, getToken } = stubCredential(Date.now() + HOUR_MS);
    setCredentialForTesting(credential);

    expect(await authHeaders('secret')).toEqual({ 'api-key': 'secret' });
    expect(getToken).not.toHaveBeenCalled();
  });

  it('falls back to a bearer token when no key is configured', async () => {
    const { credential } = stubCredential(Date.now() + HOUR_MS);
    setCredentialForTesting(credential);

    expect(await authHeaders(undefined)).toEqual({ Authorization: 'Bearer token-1' });
  });

  it('treats an empty key as no key, so a blank setting cannot send an empty api-key', async () => {
    const { credential } = stubCredential(Date.now() + HOUR_MS);
    setCredentialForTesting(credential);

    expect(await authHeaders('')).toEqual({ Authorization: 'Bearer token-1' });
  });

  it('returns a fresh object each call so one caller cannot mutate the next', async () => {
    const headers = await authHeaders('secret');
    headers['api-key'] = 'tampered';

    expect(await authHeaders('secret')).toEqual({ 'api-key': 'secret' });
  });
});
