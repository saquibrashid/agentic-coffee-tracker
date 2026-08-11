import { describe, expect, it } from 'vitest';

import { SyncApiError } from './api';

/**
 * The classification table, asserted directly.
 *
 * `CloudSyncEngine` branches on `isTransient` alone, so a misclassification is
 * invisible until it is expensive: a terminal error marked transient becomes an
 * infinite retry loop against the user's own subscription, and a transient one
 * marked terminal halts sync until the app is restarted. Neither shows up in a
 * happy-path test.
 */

function error(status: number): SyncApiError {
  return new SyncApiError({ status, message: `status ${status}` });
}

describe('SyncApiError.isTransient', () => {
  it.each([
    ['contention from another device', 409],
    ['a rate-limited request', 429],
    ['a bad gateway', 502],
    ['an unavailable store', 503],
    ['a gateway timeout', 504],
  ])('retries %s', (_label, status) => {
    expect(error(status).isTransient).toBe(true);
  });

  it.each([
    ['a malformed request this build will always send', 400],
    ['an expired session', 401],
    ['an account without access', 403],
    ['a missing resource', 404],
  ])('stops on %s', (_label, status) => {
    expect(error(status).isTransient).toBe(false);
  });

  it('stops on 507, despite it being a 5xx', () => {
    // The trap: 507 falls inside the `>= 500` catch-all but is not a server
    // fault. The partition is full, and retrying spends the rate budget to be
    // refused identically every time until the user frees space.
    expect(error(507).isTransient).toBe(false);
  });

  it('carries the quota numbers through for the UI to report', () => {
    const err = new SyncApiError({
      status: 507,
      message: 'Cloud storage is full.',
      details: { quota: { used: 20_000, limit: 20_000 } },
    });

    expect(err.details?.quota).toEqual({ used: 20_000, limit: 20_000 });
  });
});
