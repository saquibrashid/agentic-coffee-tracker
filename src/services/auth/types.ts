/**
 * Identity, as an interface the rest of the app can depend on before there is
 * anything behind it.
 *
 * v1 has no accounts: everything lives in IndexedDB on one device, and that
 * remains a fully supported way to run the app forever. `specs/sync.md` adds
 * opt-in sign-in for multi-device sync, so this interface exists now to keep
 * every call site written once — signed out is a real state, not a missing
 * feature, and `LocalOnlyAuthProvider` implements it honestly.
 */

/**
 * The providers the app is willing to talk to.
 *
 * Deliberately a closed union rather than a string: `staticwebapp.config.json`
 * explicitly 404s every provider it does not configure, and this type is the
 * client-side half of that same allowlist.
 */
export type AuthProviderId = 'aad' | 'apple';

/** Who is signed in, as reported by the identity provider. */
export interface AuthUser {
  /**
   * Stable per-provider subject identifier. This becomes the Cosmos partition
   * key once sync ships, so it must never be derived from anything the user can
   * change, such as an email address.
   */
  userId: string;
  /** Display name, when the provider supplies one. */
  displayName?: string;
  /** Which identity provider vouched for this user. */
  provider: AuthProviderId;
}

export interface AuthProvider {
  /** The signed-in user, or `null` when signed out. Never throws. */
  getUser(): Promise<AuthUser | null>;
  /** Begins sign-in. May navigate away, so callers must not rely on it returning. */
  login(provider: AuthProviderId): Promise<void>;
  /** Ends the session. Local data is always retained. */
  logout(): Promise<void>;
  /** False when this build cannot sign anyone in, so the UI can omit the option. */
  readonly isAvailable: boolean;
}
