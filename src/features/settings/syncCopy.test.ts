import { describe, expect, it } from 'vitest';

import type { SyncStatus } from '@/services/sync/types';

import { describeSync } from './syncCopy';

const NOW = new Date('2026-01-02T12:00:00.000Z').getTime();

function status(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return { state: 'idle', lastSyncedAt: null, pendingCount: 0, ...overrides };
}

describe('describeSync', () => {
  it('never claims everything is fine', () => {
    // A permanent reassurance is exactly what trains people to stop reading the
    // one line that will eventually carry a real warning.
    const line = describeSync(status({ lastSyncedAt: '2026-01-02T11:59:30.000Z' }), NOW);
    expect(line).toBe('Synced just now.');
  });

  it('names outstanding work ahead of the last success', () => {
    // What matters when something is queued is that it is queued, not that a
    // previous cycle once succeeded.
    expect(
      describeSync(status({ pendingCount: 3, lastSyncedAt: '2026-01-02T11:00:00.000Z' }), NOW),
    ).toBe('3 changes pending.');
  });

  it('gets the singular right', () => {
    expect(describeSync(status({ pendingCount: 1 }), NOW)).toBe('1 change pending.');
  });

  it('says so when nothing has ever synced', () => {
    expect(describeSync(status(), NOW)).toBe('Not synced yet.');
  });

  it('scales the relative time', () => {
    expect(describeSync(status({ lastSyncedAt: '2026-01-02T11:58:00.000Z' }), NOW)).toBe(
      'Synced 2 minutes ago.',
    );
    expect(describeSync(status({ lastSyncedAt: '2026-01-02T09:00:00.000Z' }), NOW)).toBe(
      'Synced 3 hours ago.',
    );
    expect(describeSync(status({ lastSyncedAt: '2025-12-31T12:00:00.000Z' }), NOW)).toBe(
      'Synced 2 days ago.',
    );
  });

  it('does not report the future when a clock is skewed', () => {
    // A device whose clock runs behind the server's would otherwise render a
    // negative duration.
    expect(describeSync(status({ lastSyncedAt: '2026-01-02T12:05:00.000Z' }), NOW)).toBe(
      'Synced just now.',
    );
  });

  it('presents offline as a state rather than a failure', () => {
    // Local data is untouched and the app is fully usable; calling it an error
    // would be both untrue and alarming.
    expect(describeSync(status({ state: 'offline' }), NOW)).toBe(
      'Offline — will sync when reconnected.',
    );
  });

  it('counts what is waiting while offline', () => {
    expect(
      describeSync(
        status({ state: 'offline', pendingCount: 2, lastSyncedAt: '2026-01-02T09:00:00.000Z' }),
        NOW,
      ),
    ).toBe('Offline — 2 changes will sync when reconnected.');
  });

  it('stops reassuring once changes have been stranded for a day', () => {
    // The reassuring version is what let a device sit broken unnoticed: it
    // promises a reconnection that, on a browser whose offline flag has stuck,
    // is never coming.
    expect(
      describeSync(
        status({ state: 'offline', pendingCount: 4, lastSyncedAt: '2025-12-30T12:00:00.000Z' }),
        NOW,
      ),
    ).toBe(
      '4 changes still waiting to sync. Last synced 3 days ago. If this device is online, press Sync now.',
    );
  });

  it('keeps quiet about a short outage', () => {
    // A phone on a flight is working exactly as designed and must not be
    // nagged, or the warning stops meaning anything when it matters.
    expect(
      describeSync(
        status({ state: 'offline', pendingCount: 4, lastSyncedAt: '2026-01-02T02:00:00.000Z' }),
        NOW,
      ),
    ).toBe('Offline — 4 changes will sync when reconnected.');
  });

  it('explains that an expired session leaves changes waiting', () => {
    expect(describeSync(status({ state: 'session-expired', pendingCount: 2 }), NOW)).toBe(
      'Sign in again to sync 2 pending changes.',
    );
  });

  it('surfaces the actual error when there is one', () => {
    expect(describeSync(status({ state: 'error', lastError: 'Sign-in expired' }), NOW)).toBe(
      'Sign-in expired',
    );
  });

  it('falls back to something actionable when an error has no message', () => {
    expect(describeSync(status({ state: 'error' }), NOW)).toMatch(/retry automatically/);
  });

  it('tells an out-of-date build what to do', () => {
    expect(describeSync(status({ state: 'needs-upgrade' }), NOW)).toMatch(/Refresh/);
  });

  it('is honest in a build that cannot sync', () => {
    expect(describeSync(status({ state: 'disabled' }), NOW)).toMatch(/stay on this device/);
  });
});
