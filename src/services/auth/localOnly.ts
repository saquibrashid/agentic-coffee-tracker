/**
 * The signed-out provider: the whole of v1, and the permanent fallback.
 *
 * This is not a stub that throws "not implemented". Running without an account
 * is a supported configuration — no data leaves the device, which is exactly
 * what `SECURITY.md` promises today — so this provider reports that state
 * truthfully and never pretends a sign-in is coming.
 */
import type { AuthProvider, AuthProviderId, AuthUser } from './types';

export class LocalOnlyAuthProvider implements AuthProvider {
  readonly isAvailable = false;

  getUser(): Promise<AuthUser | null> {
    return Promise.resolve(null);
  }

  /**
   * Rejects rather than resolving silently.
   *
   * A no-op would leave a caller waiting for a sign-in that will never arrive,
   * and the UI would have no way to tell "still signing in" from "cannot".
   * `isAvailable` is the flag to branch on; reaching here is a bug worth
   * hearing about.
   */
  login(provider: AuthProviderId): Promise<void> {
    return Promise.reject(
      new Error(`Sign-in with ${provider} is not available in this build (local-only mode).`),
    );
  }

  /** Signing out of nothing succeeds. Idempotent by definition. */
  logout(): Promise<void> {
    return Promise.resolve();
  }
}
