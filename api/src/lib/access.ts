/**
 * Decides *which* authenticated accounts may use sync.
 *
 * `requirePrincipal` answers "is this a real signed-in user?". That is a
 * different question from "is this user welcome here?": Microsoft accounts are
 * free and unlimited, so authentication alone lets anyone on the internet mint
 * a partition in someone else's Cosmos account and spend their RUs.
 *
 * The policy is configuration rather than code so the deployment can move from
 * a single owner to an approved list to fully public without a code change.
 * `specs/sync.md` -> Decisions § Access policy.
 */
import type { Principal } from './principal.js';

export type AccessMode = 'owner' | 'allowlist' | 'open';

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export interface AccessPolicy {
  mode: AccessMode;
  /** Lower-cased user ids and/or sign-in names. Unused when mode is 'open'. */
  allowed: ReadonlySet<string>;
}

/**
 * `owner` and `allowlist` behave identically — both check membership. They are
 * separate values so the deployment states its *intent*, which is what makes
 * the eventual widening a one-word config change with an obvious meaning
 * rather than a silently growing list.
 */
const MEMBERSHIP_MODES: ReadonlySet<string> = new Set(['owner', 'allowlist']);

/**
 * Splits on commas, semicolons and any whitespace, so a list pasted out of a
 * portal blade or spread across lines in a Bicep parameter behaves the same.
 */
export function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[\s,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry !== ''),
  );
}

export function readAccessPolicy(env: NodeJS.ProcessEnv = process.env): AccessPolicy {
  const configured = (env['SYNC_ACCESS_MODE'] ?? '').trim().toLowerCase();

  // Anything unrecognised — a typo, an empty value, a mode from a newer build —
  // falls back to membership rather than to 'open'. A misconfiguration must
  // never be the thing that publishes someone's coffee library to the world.
  const mode: AccessMode =
    configured === 'open' ? 'open' : configured === 'owner' ? 'owner' : 'allowlist';

  return { mode, allowed: parseAllowlist(env['SYNC_ALLOWLIST']) };
}

/**
 * Whether this principal may sync under the given policy.
 *
 * Matching accepts either the stable `userId` or the sign-in name. The id is
 * the durable identifier and the one to configure; the sign-in name is
 * supported because it is the only value an operator can know *before* the
 * first sign-in, which is what makes bootstrapping possible at all.
 */
export function isAllowed(principal: Principal, policy: AccessPolicy): boolean {
  if (policy.mode === 'open') return true;
  if (!MEMBERSHIP_MODES.has(policy.mode)) return false;

  // An empty list denies everyone, including the owner. That is deliberate: the
  // alternative — treating "unconfigured" as "allow all" — would silently open
  // the deployment the moment a parameter went missing.
  if (policy.allowed.size === 0) return false;

  if (policy.allowed.has(principal.userId.toLowerCase())) return true;

  const name = principal.userDetails?.trim().toLowerCase();
  return name !== undefined && name !== '' && policy.allowed.has(name);
}

/** Throws `ForbiddenError` when the caller is authenticated but not approved. */
export function requireAccess(principal: Principal, env: NodeJS.ProcessEnv = process.env): void {
  const policy = readAccessPolicy(env);
  if (isAllowed(principal, policy)) return;

  // Deliberately explicit. The caller is a real signed-in user, and leaving
  // them with a bare 403 turns a two-minute configuration fix into a debugging
  // session. It reveals nothing: they already know their own identity, and the
  // message does not disclose who *is* approved.
  throw new ForbiddenError(
    'This deployment is restricted to approved accounts. ' +
      `Add "${principal.userId}" to SYNC_ALLOWLIST to grant access.`,
  );
}
