/**
 * Identity via the Azure Static Web Apps built-in authentication endpoints.
 *
 * SWA runs the whole OAuth dance at the edge, before the request ever reaches
 * this app: `/.auth/login/<provider>` starts it, `/.auth/me` reports the result,
 * `/.auth/logout` ends it. There is no token for this code to hold, store or
 * refresh — which is the main reason to use it. A token this code never sees is
 * a token it cannot leak.
 *
 * See `specs/sync.md` → Identity.
 */
import type { AuthProvider, AuthProviderId, AuthUser } from './types';

/**
 * The providers that are actually configured in `public/staticwebapp.config.json`.
 *
 * Apple is in the `AuthProviderId` union because the spec plans for it, but it
 * needs a paid developer account and a client secret that expires every six
 * months — open question 2 in `specs/sync.md`, still unresolved. Until that is
 * answered, Apple is 404'd in the SWA config, so offering it here would send
 * people to an error page. Listing configured providers separately from
 * supported ones lets `login()` fail with a sentence instead.
 */
export const CONFIGURED_PROVIDERS: readonly AuthProviderId[] = ['aad'];

/** Shape of `/.auth/me`. Only the fields this app relies on. */
interface ClientPrincipal {
  userId?: unknown;
  userDetails?: unknown;
  identityProvider?: unknown;
}

function asAuthUser(principal: ClientPrincipal): AuthUser | null {
  const { userId, userDetails, identityProvider } = principal;

  // A principal without a stable subject is unusable: userId becomes the Cosmos
  // partition key, so a blank one would collide every such user into one
  // dataset. Treat it as signed out rather than inventing an identity.
  if (typeof userId !== 'string' || userId === '') return null;

  // Only accept providers this build configured. If SWA ever reports another
  // one it means a provider is reachable that the config was meant to 404, and
  // trusting it would let an unreviewed identity source mint partition keys.
  const provider = CONFIGURED_PROVIDERS.find((id) => id === identityProvider);
  if (!provider) return null;

  const displayName =
    typeof userDetails === 'string' && userDetails !== '' ? userDetails : undefined;
  return displayName ? { userId, provider, displayName } : { userId, provider };
}

export class SwaAuthProvider implements AuthProvider {
  readonly isAvailable = true;

  /**
   * In-flight request, so a page that renders several account-aware components
   * on mount asks the edge once rather than once per component.
   *
   * Only the pending promise is shared, not the resolved value: sign-in and
   * sign-out both navigate the page, so there is no long-lived session state
   * here worth invalidating.
   */
  #inFlight: Promise<AuthUser | null> | null = null;

  getUser(): Promise<AuthUser | null> {
    this.#inFlight ??= this.#fetchUser().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #fetchUser(): Promise<AuthUser | null> {
    try {
      const response = await fetch('/.auth/me', {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return null;

      const body: unknown = await response.json();
      const principal = (body as { clientPrincipal?: ClientPrincipal | null } | null)
        ?.clientPrincipal;
      return principal ? asAuthUser(principal) : null;
    } catch {
      // `/.auth/me` is unreachable offline, and in local `vite dev` it does not
      // exist at all. Neither is an error worth showing: the honest answer to
      // "who is signed in" when we cannot ask is "nobody", and the app works
      // signed out. The interface promises this never throws.
      return null;
    }
  }

  /**
   * Hands off to the SWA login endpoint.
   *
   * This navigates away, so it does not resolve to a signed-in user — the
   * answer arrives as a fresh page load, where `getUser()` reports it.
   */
  login(provider: AuthProviderId): Promise<void> {
    if (!CONFIGURED_PROVIDERS.includes(provider)) {
      return Promise.reject(
        new Error(`Sign-in with ${provider} is not configured for this deployment.`),
      );
    }
    window.location.assign(
      `/.auth/login/${provider}?post_login_redirect_uri=${encodeURIComponent(currentPath())}`,
    );
    return Promise.resolve();
  }

  /** Ends the SWA session. Local IndexedDB data is deliberately left untouched. */
  logout(): Promise<void> {
    window.location.assign(
      `/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(currentPath())}`,
    );
    return Promise.resolve();
  }
}

/**
 * Where to come back to, as a same-origin path.
 *
 * Path-only on purpose: SWA will redirect to whatever is passed here, so
 * building it from anything but `window.location` risks turning sign-in into an
 * open redirect.
 */
function currentPath(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}
