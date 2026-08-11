/**
 * The gate every `/api/sync/*` handler passes through.
 *
 * Three checks that must happen in order and must never be partially applied:
 * is the caller authenticated (`principal.ts`), are they approved for this
 * deployment (`access.ts`), and are they within their request budget
 * (`rateLimit.ts`). Each handler used to open with a hand-copied version of the
 * first two, which is precisely the shape of duplication that lets a new
 * endpoint ship with one of them missing.
 *
 * The order is not arbitrary. Rate limiting comes last so that an unauthorised
 * caller cannot consume an approved user's budget: the bucket is keyed by
 * `userId`, and charging it before establishing that the userId is real and
 * admitted would let a forged header starve the account it names.
 */
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { errorResponse, json } from './http.js';
import { UnauthenticatedError, requirePrincipal, type Principal } from './principal.js';
import { ForbiddenError, requireAccess } from './access.js';
import { consume } from './rateLimit.js';

/**
 * Either the caller, or the response to send instead. A discriminated union
 * rather than an exception so the handler cannot forget to stop.
 */
export type SyncCaller =
  { ok: true; principal: Principal } | { ok: false; response: HttpResponseInit };

export function resolveSyncCaller(req: HttpRequest, ctx: InvocationContext): SyncCaller {
  let principal: Principal;
  try {
    principal = requirePrincipal(req);
    requireAccess(principal);
  } catch (err) {
    if (err instanceof UnauthenticatedError)
      return { ok: false, response: json(401, { error: err.message }) };
    if (err instanceof ForbiddenError)
      return { ok: false, response: json(403, { error: err.message }) };
    return {
      ok: false,
      response: errorResponse(ctx, 500, 'Could not resolve the caller identity', err),
    };
  }

  const limit = consume(principal.userId);
  if (!limit.allowed) {
    ctx.warn('sync rate limit', { retryAfterSeconds: limit.retryAfterSeconds });
    return {
      ok: false,
      response: {
        status: 429,
        headers: {
          'content-type': 'application/json',
          // The client already treats 429 as retryable and backs off on its own
          // schedule, but Retry-After is what makes the response meaningful to
          // anything else that speaks HTTP.
          'retry-after': String(limit.retryAfterSeconds),
        },
        body: JSON.stringify({ error: 'Too many sync requests. Try again shortly.' }),
      },
    };
  }

  return { ok: true, principal };
}
