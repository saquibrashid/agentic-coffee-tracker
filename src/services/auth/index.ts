/**
 * Chooses the auth provider for this build.
 *
 * Signing in is optional and always will be: running local-only is a supported
 * configuration, not a degraded one. This module decides whether the option is
 * even offered, so the UI never shows a sign-in button that cannot work.
 */
import { LocalOnlyAuthProvider } from './localOnly';
import { SwaAuthProvider } from './swa';
import type { AuthProvider } from './types';
import { isLinkedBackendTopology } from '../platform/topology';

/**
 * Whether this build can sign anyone in.
 *
 * Two conditions, for different reasons:
 *
 * 1. **Topology.** Identity is only trustworthy behind the SWA linked backend
 *    (`services/platform/topology.ts`). Signing in on a build that calls the
 *    Function App directly would produce an identity the server cannot verify —
 *    worse than no identity, because it looks like one.
 * 2. **`VITE_AUTH_ENABLED` is explicitly `'true'`.** Sign-in depends on an
 *    identity provider being registered in Azure, which is a manual step
 *    (`docs/deployment.md` → Authentication). Defaulting to on would put a
 *    button on the live site that redirects to an error page the moment this
 *    merges, so the code ships dark and the flag is flipped once the provider
 *    exists. It also keeps `vite dev` and the test runner honest, since neither
 *    serves the `/.auth/*` endpoints at all.
 *
 * The flag cannot override the topology check: that one is a security boundary,
 * so it fails closed.
 */
export function isAuthSupported(): boolean {
  if (!isLinkedBackendTopology()) return false;
  return import.meta.env.VITE_AUTH_ENABLED === 'true';
}

let provider: AuthProvider | null = null;

/** The process-wide auth provider. */
export function getAuthProvider(): AuthProvider {
  // Every provider must be selected here, behind isAuthSupported(), so the
  // topology gate cannot be bypassed by a caller constructing one directly.
  provider ??= isAuthSupported() ? new SwaAuthProvider() : new LocalOnlyAuthProvider();
  return provider;
}

/** Test seam: drops the cached provider so the next call re-selects. */
export function resetAuthProviderForTests(): void {
  provider = null;
}

export { LocalOnlyAuthProvider } from './localOnly';
export { SwaAuthProvider, CONFIGURED_PROVIDERS } from './swa';
export { useAuthUser } from './useAuthUser';
export type { AuthProvider, AuthProviderId, AuthUser } from './types';
