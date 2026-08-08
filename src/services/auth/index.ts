/**
 * Chooses the auth provider for this build.
 *
 * v1 has exactly one: nobody signs in. `specs/sync.md` Phase 1 adds the SWA
 * provider here, and the swap should be the only change any caller needs.
 */
import { LocalOnlyAuthProvider } from './localOnly';
import type { AuthProvider } from './types';

let provider: AuthProvider | null = null;

/** The process-wide auth provider. */
export function getAuthProvider(): AuthProvider {
  provider ??= new LocalOnlyAuthProvider();
  return provider;
}

/** Test seam: drops the cached provider so the next call re-selects. */
export function resetAuthProviderForTests(): void {
  provider = null;
}

export { LocalOnlyAuthProvider } from './localOnly';
export type { AuthProvider, AuthProviderId, AuthUser } from './types';
