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

  it('keeps actionable failures visible', () => {
    expect(syncMessage(status({ state: 'error', lastError: 'Sign in again.' }))).toBe(
      'Sign in again.',
    );
    expect(syncMessage(status({ state: 'needs-upgrade' }))).toMatch(/Refresh/);
  });
});
