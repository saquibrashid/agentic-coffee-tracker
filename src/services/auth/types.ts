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
 * A single-member union rather than a string, and deliberately still a union:
 * Microsoft is the only identity provider (`specs/sync.md` → Decisions § 2 —
 * Apple was dropped rather than deferred, because a client secret expiring
 * every 6 months is a recurring manual rotation that fails closed silently,
 * long after anyone remembers why). This type is the client-side half of the
 * allowlist that `staticwebapp.config.json` enforces by 404ing everything else.
 */
export type AuthProviderId = 'aad';

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

/**
 * How far a sign-out reaches.
 *
 * `app` ends this app's session only. `everywhere` also ends the session at the
 * identity provider, which is the only way to be offered a different account on
 * the next sign-in — see `switchAccount.ts` for why sign-in itself cannot ask.
 */
export type SignOutScope = 'app' | 'everywhere';

export interface AuthProvider {
  /** The signed-in user, or `null` when signed out. Never throws. */
  getUser(): Promise<AuthUser | null>;
  /** Begins sign-in. May navigate away, so callers must not rely on it returning. */
  login(provider: AuthProviderId): Promise<void>;
  /**
   * Ends the session. Local data is always retained.
   *
   * `everywhere` navigates to the identity provider and does not come back, so
   * nothing may be queued after it.
   */
  logout(scope?: SignOutScope): Promise<void>;
  /** False when this build cannot sign anyone in, so the UI can omit the option. */
  readonly isAvailable: boolean;
}
