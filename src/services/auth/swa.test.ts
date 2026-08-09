import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONFIGURED_PROVIDERS, SwaAuthProvider } from './swa';
import { getAuthProvider, isAuthSupported, resetAuthProviderForTests } from './index';
import { LocalOnlyAuthProvider } from './localOnly';
import type { AuthProviderId } from './types';

function respondWith(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  resetAuthProviderForTests();
});

describe('SwaAuthProvider.getUser', () => {
  it('maps a client principal to a user', async () => {
    globalThis.fetch = respondWith({
      clientPrincipal: {
        userId: 'abc123',
        userDetails: 'sam@example.com',
        identityProvider: 'aad',
      },
    });

    await expect(new SwaAuthProvider().getUser()).resolves.toEqual({
      userId: 'abc123',
      displayName: 'sam@example.com',
      provider: 'aad',
    });
  });

  it('reports signed out when there is no principal', async () => {
    globalThis.fetch = respondWith({ clientPrincipal: null });
    await expect(new SwaAuthProvider().getUser()).resolves.toBeNull();
  });

  it('rejects a principal with no userId', async () => {
    // userId becomes the Cosmos partition key. A blank one would collide every
    // such user into a single shared dataset.
    globalThis.fetch = respondWith({
      clientPrincipal: { userId: '', userDetails: 'sam', identityProvider: 'aad' },
    });
    await expect(new SwaAuthProvider().getUser()).resolves.toBeNull();
  });

  it('rejects a principal from a provider this build did not configure', async () => {
    // Reaching here means a provider is live that the SWA config should have
    // 404'd. Trusting it would let an unreviewed identity source mint keys.
    globalThis.fetch = respondWith({
      clientPrincipal: { userId: 'abc123', userDetails: 'sam', identityProvider: 'github' },
    });
    await expect(new SwaAuthProvider().getUser()).resolves.toBeNull();
  });

  it('omits the display name when the provider does not supply one', async () => {
    globalThis.fetch = respondWith({
      clientPrincipal: { userId: 'abc123', userDetails: '', identityProvider: 'aad' },
    });
    await expect(new SwaAuthProvider().getUser()).resolves.toEqual({
      userId: 'abc123',
      provider: 'aad',
    });
  });

  it('reports signed out rather than throwing when the endpoint is unreachable', async () => {
    // Offline, or plain `vite dev` where /.auth/* does not exist. The interface
    // promises getUser never throws, and the app works fine signed out.
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(new SwaAuthProvider().getUser()).resolves.toBeNull();
  });

  it('reports signed out on a non-OK response', async () => {
    globalThis.fetch = respondWith({}, false);
    await expect(new SwaAuthProvider().getUser()).resolves.toBeNull();
  });

  it('coalesces concurrent lookups into one request', async () => {
    const fetchMock = respondWith({ clientPrincipal: null });
    globalThis.fetch = fetchMock;
    const provider = new SwaAuthProvider();

    await Promise.all([provider.getUser(), provider.getUser(), provider.getUser()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks again after the previous lookup settles', async () => {
    const fetchMock = respondWith({ clientPrincipal: null });
    globalThis.fetch = fetchMock;
    const provider = new SwaAuthProvider();

    await provider.getUser();
    await provider.getUser();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('SwaAuthProvider.login', () => {
  const assign = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('location', {
      assign,
      pathname: '/settings',
      search: '?tab=account',
      hash: '',
    });
    assign.mockClear();
  });

  it('sends the browser to the SWA login endpoint and back to where it started', async () => {
    await new SwaAuthProvider().login('aad');
    expect(assign).toHaveBeenCalledWith(
      '/.auth/login/aad?post_login_redirect_uri=%2Fsettings%3Ftab%3Daccount',
    );
  });

  it('refuses a provider that is not configured for this deployment', async () => {
    // Not reachable through the type today. The scenario it guards is a future
    // contributor widening AuthProviderId without adding the provider to
    // staticwebapp.config.json, which would redirect people to a 404.
    const unconfigured = 'google' as unknown as AuthProviderId;
    await expect(new SwaAuthProvider().login(unconfigured)).rejects.toThrow(/not configured/);
    expect(assign).not.toHaveBeenCalled();
  });

  it('signs out through the SWA logout endpoint', async () => {
    await new SwaAuthProvider().logout();
    expect(assign).toHaveBeenCalledWith(
      '/.auth/logout?post_logout_redirect_uri=%2Fsettings%3Ftab%3Daccount',
    );
  });

  it('configures Microsoft and nothing else', () => {
    // specs/sync.md → Decisions § 2: Apple was dropped rather than deferred.
    expect(CONFIGURED_PROVIDERS).toEqual(['aad']);
  });
});

describe('isAuthSupported', () => {
  it('is off by default, until an identity provider is registered in Azure', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    expect(isAuthSupported()).toBe(false);
  });

  it('is on when the deployment opts in', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');
    expect(isAuthSupported()).toBe(true);
  });

  it('treats any value other than "true" as off', () => {
    // Fail closed on typos: VITE_AUTH_ENABLED=1 or =yes must not switch on a
    // sign-in flow whose provider may not exist yet.
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_AUTH_ENABLED', '1');
    expect(isAuthSupported()).toBe(false);
  });

  it('stays off when the client calls the Function App directly, override or not', () => {
    // The topology check is a security boundary, so it must not be overridable:
    // an identity the server cannot verify is worse than none, because it looks
    // like one. See specs/sync.md → Identity.
    vi.stubEnv('VITE_API_BASE_URL', 'https://func-coffee.azurewebsites.net');
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');
    expect(isAuthSupported()).toBe(false);
  });
});

describe('getAuthProvider', () => {
  it('returns the same instance every time', () => {
    expect(getAuthProvider()).toBe(getAuthProvider());
  });

  it('is local-only when auth is unavailable', () => {
    expect(getAuthProvider()).toBeInstanceOf(LocalOnlyAuthProvider);
  });

  it('selects the SWA provider once auth is available', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');
    expect(getAuthProvider()).toBeInstanceOf(SwaAuthProvider);
  });

  it('stays local-only in the untrusted topology', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://func-coffee.azurewebsites.net');
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');
    expect(getAuthProvider()).toBeInstanceOf(LocalOnlyAuthProvider);
  });
});
