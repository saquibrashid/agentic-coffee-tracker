import { describe, expect, it } from 'vitest';

import type { SyncStatus } from './types';

import { isSyncStale, STALE_AFTER_MS } from './staleness';

const NOW = new Date('2026-01-02T12:00:00.000Z').getTime();

function status(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return { state: 'offline', lastSyncedAt: null, pendingCount: 0, ...overrides };
}

describe('isSyncStale', () => {
  it('is false when nothing is waiting', () => {
    // Being offline with an empty outbox costs the user nothing, so there is
    // nothing to warn about however long it lasts.
    expect(isSyncStale(status({ lastSyncedAt: '2020-01-01T00:00:00.000Z' }), NOW)).toBe(false);
  });

  it('is false for an outage shorter than a day', () => {
    expect(
      isSyncStale(status({ pendingCount: 3, lastSyncedAt: '2026-01-02T00:00:00.000Z' }), NOW),
    ).toBe(false);
  });

  it('is true once waiting changes pass the threshold', () => {
    const at = new Date(NOW - STALE_AFTER_MS).toISOString();
    expect(isSyncStale(status({ pendingCount: 1, lastSyncedAt: at }), NOW)).toBe(true);
  });

  it('stays quiet for a device that has never synced', () => {
    // No history means no duration to measure, and the likeliest explanation is
    // a device set up minutes ago that happens to be offline right now. Warning
    // there would fire on a brand new install, which is the worst first
    // impression available.
    expect(isSyncStale(status({ pendingCount: 5, lastSyncedAt: null }), NOW)).toBe(false);
  });
});
