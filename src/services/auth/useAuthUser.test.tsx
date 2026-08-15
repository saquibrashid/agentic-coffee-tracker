import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import {
  allowAuthUser,
  forgetAuthUser,
  hasRememberedAuthUser,
  rememberAuthUser,
  refreshAuthUser,
  resetAuthProviderForTests,
  resetAuthUserForTests,
  useAuthUser,
} from './index';

const assign = vi.fn();

beforeEach(async () => {
  vi.stubEnv('VITE_API_BASE_URL', '');
  vi.stubEnv('VITE_AUTH_ENABLED', 'true');
  vi.stubGlobal('location', {
    assign,
    pathname: '/',
    search: '',
    hash: '',
  });
  resetAuthProviderForTests();
  resetAuthUserForTests();
  assign.mockClear();
  await db.meta.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetAuthProviderForTests();
  resetAuthUserForTests();
});

describe('shared auth state', () => {
  it('coalesces callers and remembers a successful session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          clientPrincipal: {
            userId: 'user-a',
            userDetails: 'sam@example.com',
            identityProvider: 'aad',
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([refreshAuthUser(), refreshAuthUser()]);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(hasRememberedAuthUser()).resolves.toBe(true);
  });

  it('clears the remembered session before deliberate sign-out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            clientPrincipal: {
              userId: 'user-a',
              userDetails: 'sam@example.com',
              identityProvider: 'aad',
            },
          }),
      }),
    );
    const { result } = renderHook(() => useAuthUser());
    await waitFor(() => expect(result.current.user?.userId).toBe('user-a'));

    await act(() => result.current.logout());

    await expect(hasRememberedAuthUser()).resolves.toBe(false);
    expect(assign).toHaveBeenCalledWith('/.auth/logout?post_logout_redirect_uri=%2F');
  });

  it('does not restore the session marker from an auth check that finishes after sign-out', async () => {
    await rememberAuthUser('user-a');
    let release: (response: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    );

    const pending = refreshAuthUser();
    const { result } = renderHook(() => useAuthUser());
    await act(async () => {
      await result.current.logout();
    });
    release({
      ok: true,
      json: () =>
        Promise.resolve({
          clientPrincipal: {
            userId: 'user-a',
            userDetails: 'sam@example.com',
            identityProvider: 'aad',
          },
        }),
    });

    await expect(pending).resolves.toBeNull();
    await expect(hasRememberedAuthUser()).resolves.toBe(false);
  });

  it('rejects a stale user from another tab until sign-in is explicitly started', async () => {
    await forgetAuthUser();

    await expect(rememberAuthUser('stale-user')).resolves.toBe(false);
    await expect(hasRememberedAuthUser()).resolves.toBe(false);

    await allowAuthUser();
    await expect(rememberAuthUser('new-session')).resolves.toBe(true);
    await expect(hasRememberedAuthUser()).resolves.toBe(true);
  });
});
