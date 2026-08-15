import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { getAuthProvider } from './index';
import { allowAuthUser, forgetAuthUser, rememberAuthUser } from './session';
import type { AuthProviderId, AuthUser } from './types';

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  available: boolean;
  login: (provider: AuthProviderId) => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
}

interface AuthSnapshot {
  user: AuthUser | null;
  loading: boolean;
  available: boolean;
  error: string | null;
}

const subscribers = new Set<() => void>();
let snapshot: AuthSnapshot | null = null;
let request: Promise<AuthUser | null> | null = null;
let authGeneration = 0;

function getSnapshot(): AuthSnapshot {
  if (!snapshot) {
    const available = getAuthProvider().isAvailable;
    snapshot = { user: null, loading: available, available, error: null };
  }
  return snapshot;
}

function subscribe(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function publish(next: AuthSnapshot): void {
  snapshot = next;
  for (const subscriber of subscribers) subscriber();
}

/**
 * Refreshes the shared auth snapshot.
 *
 * The sync engine calls this on every cycle so session changes update all
 * mounted account controls. Concurrent callers share the same `/.auth/me`
 * request rather than racing independent copies of auth state.
 */
export async function refreshAuthUser(): Promise<AuthUser | null> {
  const current = getSnapshot();
  if (!current.available) return null;
  if (request) return request;

  const generation = authGeneration;
  publish({ ...current, error: null });
  const nextRequest = getAuthProvider()
    .getUser()
    .then(async (user) => {
      if (generation !== authGeneration) return null;
      const accepted = user ? await rememberAuthUser(user.userId) : true;
      const nextUser = accepted ? user : null;
      publish({ ...getSnapshot(), user: nextUser, loading: false, error: null });
      return nextUser;
    })
    .catch((cause: unknown) => {
      const error = cause instanceof Error ? cause.message : 'Could not check sign-in status.';
      publish({ ...getSnapshot(), user: null, loading: false, error });
      return null;
    })
    .finally(() => {
      if (request === nextRequest) request = null;
    });
  request = nextRequest;
  return request;
}

export function useAuthUser(): AuthState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void refreshAuthUser();
  }, []);

  const login = useCallback(async (provider: AuthProviderId) => {
    publish({ ...getSnapshot(), error: null });
    try {
      await allowAuthUser();
      await getAuthProvider().login(provider);
    } catch (cause) {
      publish({
        ...getSnapshot(),
        error: cause instanceof Error ? cause.message : 'Sign-in failed.',
      });
    }
  }, []);

  const logout = useCallback(async () => {
    publish({ ...getSnapshot(), error: null });
    try {
      authGeneration += 1;
      await forgetAuthUser();
      publish({ ...getSnapshot(), user: null, loading: false });
      await getAuthProvider().logout();
    } catch (cause) {
      publish({
        ...getSnapshot(),
        error: cause instanceof Error ? cause.message : 'Sign-out failed.',
      });
    }
  }, []);

  return { ...state, login, logout };
}

export function resetAuthUserForTests(): void {
  snapshot = null;
  request = null;
  authGeneration = 0;
  subscribers.clear();
}
