/**
 * The shared shape for "a service we call said no".
 *
 * Every model call in this API used to end the same way: the provider returned
 * a non-OK status, we threw a provider-specific error, and the route's blanket
 * `catch` answered 500. That flattened a passing throttle into the same status
 * as a genuine fault, and the app had no way to tell them apart — a rate-limited
 * lookup showed the user `POST /api/parse -> 500`, which reads like a bug.
 *
 * Giving both provider errors one base class means `errorResponse` can map the
 * upstream status once, for every route, instead of each route remembering to.
 */
export class UpstreamError extends Error {
  constructor(
    /** The service that answered, for logs — never shown to the user. */
    readonly provider: string,
    readonly status: number,
    readonly body: string,
    /**
     * Seconds the provider asked us to wait, when it said. Passed straight
     * through as `Retry-After`: a number we invented would be a guess about
     * someone else's capacity.
     */
    readonly retryAfterSeconds?: number,
  ) {
    super(`${provider} returned ${status}: ${body}`);
    this.name = 'UpstreamError';
  }
}

/**
 * Reads `Retry-After` when the provider sent one.
 *
 * Only the delay-seconds form is honoured. The HTTP-date form is legal but no
 * provider here uses it, and parsing a date against a clock we do not control
 * is a worse answer than letting the client's own backoff decide.
 */
export function retryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * The status we should answer with when a call to someone else failed.
 *
 * - 429 stays 429. It is the one status that means "this will work later",
 *   and the client already treats it as retryable rather than terminal.
 * - An upstream fault or timeout becomes 503: our service is fine, the thing
 *   it depends on is not, and the caller should come back.
 * - Anything else stays as the route decided. An upstream 400 means *we* sent
 *   a bad request, and reporting our own bug as the caller's is dishonest.
 */
export function statusForUpstream(err: unknown, fallback: number): number {
  if (!(err instanceof UpstreamError)) return fallback;
  if (err.status === 429) return 429;
  if (err.status === 408 || err.status >= 500) return 503;
  return fallback;
}
