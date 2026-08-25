import { describe, expect, it } from 'vitest';

import type { SyncStatus } from '@/services/sync/types';

import { syncMessage } from './syncNotice';

function status(overrides: Partial<SyncStatus>): SyncStatus {
  return {
    state: 'idle',
    pendingCount: 0,
    lastSyncedAt: null,
    ...overrides,
  };
}

describe('app sync notices', () => {
  it('keeps routine background syncing quiet', () => {
    expect(syncMessage(status({ state: 'syncing' }))).toBeNull();
    expect(
      syncMessage(status({ state: 'idle', lastSyncedAt: new Date().toISOString() })),
    ).toBeNull();
  });

  it('says nothing about being offline, which needs no action', () => {
    expect(syncMessage(status({ state: 'offline' }))).toBeNull();
    expect(
      syncMessage(
        status({ state: 'offline', pendingCount: 3, lastSyncedAt: new Date().toISOString() }),
      ),
    ).toBeNull();
  });

  it('speaks up when a device has quietly stopped syncing', () => {
    // Settings is the last place anyone looks, so a device stuck offline for a
    // day could only be discovered by comparing it against another device.
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    expect(syncMessage(status({ state: 'offline', pendingCount: 4, lastSyncedAt: old }))).toBe(
      'Not synced for a while. 4 local changes are waiting — open Settings to sync.',
    );
    expect(syncMessage(status({ state: 'offline', pendingCount: 1, lastSyncedAt: old }))).toBe(
      'Not synced for a while. 1 local change is waiting — open Settings to sync.',
    );
  });

  it('keeps actionable failures visible', () => {
    expect(syncMessage(status({ state: 'error', lastError: 'Sign in again.' }))).toBe(
      'Sign in again.',
    );
    expect(syncMessage(status({ state: 'needs-upgrade' }))).toMatch(/Refresh/);
    expect(syncMessage(status({ state: 'session-expired', pendingCount: 2 }))).toBe(
      'Sync paused. 2 local changes are safe and waiting.',
    );
  });
});
