import { beforeEach, describe, expect, it } from 'vitest';

import { SYNC_RATE_LIMIT, consume, resetRateLimitsForTests } from './rateLimit.js';

const CONFIG = { capacity: 3, refillPerSecond: 1 };
const T0 = 1_800_000_000_000;

beforeEach(() => {
  resetRateLimitsForTests();
});

describe('consume', () => {
  it('lets an unseen caller straight through', () => {
    // A new device's very first request must not be the one that gets refused.
    expect(consume('alice', CONFIG, T0).allowed).toBe(true);
  });

  it('allows a full burst and then refuses', () => {
    for (let i = 0; i < CONFIG.capacity; i++) {
      expect(consume('alice', CONFIG, T0).allowed).toBe(true);
    }
    expect(consume('alice', CONFIG, T0).allowed).toBe(false);
  });

  it('keeps buckets separate per user', () => {
    for (let i = 0; i < CONFIG.capacity; i++) consume('alice', CONFIG, T0);
    // One user exhausting their budget must not deny anybody else — otherwise
    // the limiter becomes a denial-of-service primitive rather than a defence.
    expect(consume('bob', CONFIG, T0).allowed).toBe(true);
  });

  it('refills at the configured rate', () => {
    for (let i = 0; i < CONFIG.capacity; i++) consume('alice', CONFIG, T0);
    expect(consume('alice', CONFIG, T0 + 999).allowed).toBe(false);
    expect(consume('alice', CONFIG, T0 + 1000).allowed).toBe(true);
  });

  it('never refills past capacity', () => {
    consume('alice', CONFIG, T0);
    // An hour idle does not earn an hour's worth of tokens.
    for (let i = 0; i < CONFIG.capacity; i++) {
      expect(consume('alice', CONFIG, T0 + 3_600_000).allowed).toBe(true);
    }
    expect(consume('alice', CONFIG, T0 + 3_600_000).allowed).toBe(false);
  });

  it('does not let a rejected caller reset its own clock', () => {
    for (let i = 0; i < CONFIG.capacity; i++) consume('alice', CONFIG, T0);

    // Hammering during the cooldown. Each of these is refused, and crucially
    // none of them may restart the refill window — otherwise a client in a
    // tight retry loop would never recover.
    for (let ms = 100; ms < 1000; ms += 100) {
      expect(consume('alice', CONFIG, T0 + ms).allowed).toBe(false);
    }
    expect(consume('alice', CONFIG, T0 + 1000).allowed).toBe(true);
  });

  it('reports a retry-after of at least one second', () => {
    for (let i = 0; i < CONFIG.capacity; i++) consume('alice', CONFIG, T0);
    const result = consume('alice', CONFIG, T0);

    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(result.remaining).toBe(0);
  });

  it('shrinks retry-after as the bucket refills', () => {
    const slow = { capacity: 1, refillPerSecond: 0.25 };
    consume('alice', slow, T0);

    const immediately = consume('alice', slow, T0).retryAfterSeconds;
    const later = consume('alice', slow, T0 + 2000).retryAfterSeconds;
    expect(later).toBeLessThan(immediately);
  });
});

describe('SYNC_RATE_LIMIT', () => {
  it('leaves ample headroom for a normal sync cycle', () => {
    // A device polls every 5 minutes and spends 2 requests doing it. The limit
    // is not meant to be reachable by correct behaviour, only by a loop.
    expect(SYNC_RATE_LIMIT.refillPerSecond * 60).toBeGreaterThan(60);
  });

  it('still bounds a runaway client to a countable number of requests', () => {
    let allowed = 0;
    for (let i = 0; i < 10_000; i++) {
      // Same millisecond throughout: no refill, so this measures the burst
      // ceiling alone.
      if (consume('runaway', SYNC_RATE_LIMIT, T0).allowed) allowed += 1;
    }
    expect(allowed).toBe(SYNC_RATE_LIMIT.capacity);
  });
});
