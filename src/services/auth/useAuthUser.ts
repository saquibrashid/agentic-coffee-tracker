/**
 * Reads the signed-in user for React.
 *
 * Deliberately a hook rather than context: exactly one component needs this in
 * Phase 1, and `/.auth/me` is deduplicated inside `SwaAuthProvider`, so a
 * provider tree would be ceremony without a payoff.
 */
import { useCallback, useEffect, useState } from 'react';

import { getAuthProvider, isAuthSupported } from './index';
import type { AuthProviderId, AuthUser } from './types';

export interface AuthState {
  /** The signed-in user, or `null` when signed out. */
  user: AuthUser | null;
  /** True until the first answer arrives, so the UI can avoid flashing "signed out". */
  loading: boolean;
  /** False when this build cannot sign anyone in. */
  available: boolean;
  /** Starts sign-in. Navigates away on success, so it usually does not return. */
  login: (provider: AuthProviderId) => Promise<void>;
  /** Ends the session. Local data is retained. */
  logout: () => Promise<void>;
  /** Set when sign-in or sign-out failed, for display. */
  error: string | null;
}

export function useAuthUser(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAuthProvider()
      .getUser()
      .then((next) => {
        // Guard the unmounted case: sign-out navigates the page, and setting
        // state on the way out is a warning with no upside.
        if (active) setUser(next);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (provider: AuthProviderId) => {
    setError(null);
    try {
      await getAuthProvider().login(provider);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    }
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    try {
      await getAuthProvider().logout();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-out failed.');
    }
  }, []);

  return { user, loading, available: isAuthSupported(), login, logout, error };
}
