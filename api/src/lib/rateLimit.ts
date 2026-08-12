/**
 * A per-user request budget for the sync endpoints.
 *
 * This is a **cost control, not a security control**, and the distinction
 * matters for how much to trust it. The state lives in the Function worker's
 * memory, so a scaled-out app enforces the limit once per instance rather than
 * once globally, and a cold start forgets it entirely. A determined attacker
 * can therefore exceed the nominal rate by whatever the instance count happens
 * to be.
 *
 * That is an acceptable trade here because of what it is defending. The threat
 * is not exfiltration — `requirePrincipal` and `requireAccess` handle that, and
 * every query is partition-scoped so there is nothing to reach sideways. The
 * threat is a client bug: a sync loop that retries without backing off, or a
 * photo backfill that never terminates, quietly spending RUs and invocations
 * against the operator's own subscription. A per-instance bound turns that from
 * an unbounded bill into a bounded one, which is the whole requirement.
 *
 * The alternative — a shared counter in Cosmos — would add a round trip and an
 * RU charge to *every* request in order to bound the RU charge of a few. It
 * would cost more than it saves at this scale. Revisit if the deployment ever
 * goes `SYNC_ACCESS_MODE=open`, where the callers are strangers rather than a
 * known list and the calculus changes.
 *
 * `specs/sync.md` -> Delivery phases, phase 8.
 */

export interface RateLimitConfig {
  /** Maximum burst. A full bucket allows this many requests back-to-back. */
  capacity: number;
  /** Sustained rate once the burst is spent. */
  refillPerSecond: number;
}

/**
 * Sized against the real traffic shape rather than a round number.
 *
 * A steady-state device costs two requests per 5-minute poll. The expensive
 * case is a fresh sign-in on a large library: a pull loop paging through
 * records plus a photo backfill requesting a download URL per photo. At 2/s
 * sustained that backfill still completes at a reasonable clip, while a
 * runaway retry loop — the thing being defended against — is capped at 120
 * requests a minute instead of as many as the network allows.
 */
export const SYNC_RATE_LIMIT: RateLimitConfig = { capacity: 120, refillPerSecond: 2 };

/**
 * Far tighter than the sync budget, because this one guards a bill rather than
 * a resource.
 *
 * Every allowed request generates an image, and an image costs money — unlike a
 * Cosmos read, which costs a fraction of a cent's worth of RUs. The shape being
 * defended against is different too: not a retry loop but a bulk re-shoot of a
 * whole library, which is a legitimate thing to ask for and still must not turn
 * into an unbounded spend from a single stuck client.
 *
 * 20 back-to-back covers re-shooting a shelf's worth by hand in one sitting;
 * 6/minute sustained is comfortably above what the queue runner asks for and
 * far below what a runaway client would.
 */
export const IMAGE_RATE_LIMIT: RateLimitConfig = { capacity: 20, refillPerSecond: 0.1 };

interface Bucket {
  tokens: number;
  /** ms epoch of the last refill. */
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Idle buckets are dropped after this long, so the map cannot grow without
 * bound on a long-lived worker. Only *full* buckets are evicted: discarding a
 * partially drained one would hand the caller a free reset, which is exactly
 * the state a rate limiter must not forget.
 */
const IDLE_EVICTION_MS = 10 * 60 * 1000;

/** Amortised sweep — cheaper than a timer, which would keep the worker awake. */
const SWEEP_EVERY = 256;
let sinceSweep = 0;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.tokens >= SYNC_RATE_LIMIT.capacity && now - bucket.updatedAt > IDLE_EVICTION_MS) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Whole seconds until one token is available. 0 when allowed. */
  retryAfterSeconds: number;
  /** Tokens left after this request. Exposed for logging and tests. */
  remaining: number;
}

/**
 * Charges one request against `key`'s bucket.
 *
 * `now` is injected so the refill maths can be tested at exact boundaries
 * without sleeping; production callers omit it.
 */
export function consume(
  key: string,
  config: RateLimitConfig = SYNC_RATE_LIMIT,
  now: number = Date.now(),
): RateLimitResult {
  if (++sinceSweep >= SWEEP_EVERY) {
    sinceSweep = 0;
    sweep(now);
  }

  const bucket = buckets.get(key);
  // An unseen caller starts full rather than empty: the first request from a
  // new device must not be the one that gets rejected.
  const tokens = bucket
    ? Math.min(
        config.capacity,
        bucket.tokens + ((now - bucket.updatedAt) / 1000) * config.refillPerSecond,
      )
    : config.capacity;

  if (tokens < 1) {
    // Leave the bucket exactly as it was. The refill is always recomputed from
    // `updatedAt`, so writing the refilled value back while keeping the old
    // timestamp would count the same elapsed time twice on the next call and a
    // rejected caller would recover faster the harder they hammered. Advancing
    // `updatedAt` instead is the opposite bug: the caller resets their own
    // clock on every attempt and never recovers at all. Not writing is the only
    // option that is neither.
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / config.refillPerSecond)),
      remaining: 0,
    };
  }

  const remaining = tokens - 1;
  buckets.set(key, { tokens: remaining, updatedAt: now });
  return { allowed: true, retryAfterSeconds: 0, remaining };
}

/** Test seam. Also used by nothing in production — buckets are never reset. */
export function resetRateLimitsForTests(): void {
  buckets.clear();
  sinceSweep = 0;
}
