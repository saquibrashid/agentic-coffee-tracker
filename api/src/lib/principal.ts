/**
 * Resolves the caller's identity from the SWA-injected principal header.
 *
 * Static Web Apps runs the whole OAuth exchange at the edge and forwards the
 * result to a linked backend as `x-ms-client-principal`: base64 JSON, no
 * signature. That is safe *only* because the header is set by the front door
 * and a linked Function App is not reachable any other way.
 *
 * `specs/sync.md` -> Security constraint (blocking) spells out where that
 * breaks: the Free-tier topology, where the browser calls the Function App URL
 * directly. There the header is attacker-controlled and would hand over any
 * user's data. `assertSyncTopology` below refuses to serve sync at all in that
 * configuration rather than trusting an unverifiable claim.
 */
import type { HttpRequest } from '@azure/functions';

/**
 * Providers configured on the Static Web App. Every other provider is 404'd in
 * `public/staticwebapp.config.json`; this is the second enforcement of the same
 * allowlist, because `userId` becomes a Cosmos partition key and an unreviewed
 * identity source must never be able to mint one.
 */
export const ALLOWED_PROVIDERS: ReadonlySet<string> = new Set(['aad']);

export interface Principal {
  userId: string;
  provider: string;
}

export class UnauthenticatedError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Refuses to serve sync when the principal header cannot be trusted.
 *
 * `SYNC_TRUSTED_PRINCIPAL_HEADER` is set only by the Bicep that also links the
 * Function App to the Static Web App. Absent it, we are either running the
 * Free-tier direct-call topology or a local `func start`, and in both cases the
 * header is whatever the caller typed.
 */
export function assertSyncTopology(): void {
  if (process.env['SYNC_TRUSTED_PRINCIPAL_HEADER'] !== 'true') {
    throw new UnauthenticatedError(
      'Sync is disabled in this deployment topology: the client principal header cannot be trusted.',
    );
  }
}

interface RawPrincipal {
  userId?: unknown;
  identityProvider?: unknown;
}

/**
 * Parses and validates the principal, or throws `UnauthenticatedError`.
 *
 * Every failure mode collapses to the same 401 with the same message: a caller
 * probing the boundary should not learn whether the header was missing,
 * malformed, or merely from the wrong provider.
 */
export function requirePrincipal(req: HttpRequest): Principal {
  assertSyncTopology();

  const header = req.headers.get('x-ms-client-principal');
  if (!header) throw new UnauthenticatedError();

  let raw: RawPrincipal;
  try {
    raw = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as RawPrincipal;
  } catch {
    throw new UnauthenticatedError();
  }

  const { userId, identityProvider } = raw;
  // A blank subject would collide every such caller into a single partition,
  // which is a data leak rather than a login failure.
  if (typeof userId !== 'string' || userId === '') throw new UnauthenticatedError();
  if (typeof identityProvider !== 'string' || !ALLOWED_PROVIDERS.has(identityProvider)) {
    throw new UnauthenticatedError();
  }

  return { userId, provider: identityProvider };
}
