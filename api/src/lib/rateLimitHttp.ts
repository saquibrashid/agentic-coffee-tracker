import type { HttpRequest, InvocationContext, HttpResponseInit } from '@azure/functions';

import { consume, type RateLimitConfig } from './rateLimit.js';

/**
 * The HTTP half of the rate limiter: turning a request into a bucket key, and a
 * refusal into a response.
 *
 * This lives apart from `rateLimit.ts` so the token-bucket maths stays testable
 * without an `HttpRequest`, and it exists at all because six endpoints needed
 * the identical fifteen lines. Duplicating them is how one endpoint ends up
 * returning a 429 without a `retry-after`, or keying its bucket slightly
 * differently and quietly sharing a budget with another endpoint.
 *
 * See `rateLimit.ts` for why a per-instance limit is the right trade here.
 */

/**
 * Derives the bucket key for a request.
 *
 * These endpoints are anonymous — Static Web Apps linked backends cannot
 * forward a function key — so there is no verified identity to charge. The
 * principal header is used when the front door supplied one, purely so that one
 * user's bulk import does not spend everybody else's budget, and falls back to
 * a shared bucket otherwise.
 *
 * The header is attacker-controllable in principle, which sounds fatal until
 * you notice what it would buy: a forged `userId` moves you to a *different*
 * bucket of the same size, so the ceiling on total spend is unchanged. That is
 * the whole reason this is described as a cost control rather than a security
 * control.
 *
 * `name` is part of the key so each endpoint gets its own budget. Sharing one
 * across all of them would mean an enrichment run — which legitimately calls
 * search, then scrape, then parse for a single coffee — exhausting in a third
 * of the coffees, and would let a cheap endpoint deny an expensive one.
 */
export function budgetKey(req: HttpRequest, name: string): string {
  const header = req.headers.get('x-ms-client-principal');
  if (!header) return `${name}:anonymous`;
  try {
    const raw = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as { userId?: unknown };
    return typeof raw.userId === 'string' && raw.userId !== ''
      ? `${name}:${raw.userId}`
      : `${name}:anonymous`;
  } catch {
    // A malformed header is treated as absent rather than rejected. It is not
    // this function's job to authenticate anybody, and failing the request here
    // would turn a garbled header into an outage.
    return `${name}:anonymous`;
  }
}

export interface RateLimitGuardOptions {
  /** Endpoint name. Namespaces the bucket and labels the warning. */
  name: string;
  config: RateLimitConfig;
  /**
   * What the user sees. Written for a person who did nothing wrong — the
   * overwhelmingly likely cause is a large import, not abuse.
   */
  message: string;
}

/**
 * Charges one request against the caller's budget.
 *
 * Returns a 429 to hand straight back, or `null` when the request may proceed —
 * so the call site reads as `const limited = enforceRateLimit(...); if (limited)
 * return limited;` and cannot accidentally continue after a refusal.
 *
 * `retry-after` is always set. Without it a client has no way to distinguish
 * "wait a second" from "wait ten minutes" and will either give up on work that
 * would have succeeded or retry in a tight loop, which is precisely the
 * behaviour the limit exists to stop.
 */
export function enforceRateLimit(
  req: HttpRequest,
  ctx: InvocationContext,
  options: RateLimitGuardOptions,
): HttpResponseInit | null {
  const result = consume(budgetKey(req, options.name), options.config);
  if (result.allowed) return null;

  ctx.warn(`${options.name} rate limit`, { retryAfterSeconds: result.retryAfterSeconds });
  return {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'retry-after': String(result.retryAfterSeconds),
    },
    body: JSON.stringify({ error: options.message }),
  };
}
