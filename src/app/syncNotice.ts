import type { SyncStatus } from '@/services/sync/types';
import { isSyncStale } from '@/services/sync/staleness';

/**
 * Page-level sync notices are reserved for states that need action. Routine
 * background work stays quiet; manual sync progress remains visible in Settings.
 */
export function syncMessage(status: SyncStatus): string | null {
  switch (status.state) {
    case 'error':
      return status.lastError ?? 'Sync failed. It will retry automatically.';
    case 'needs-upgrade':
      return 'Refresh to continue syncing — this version is out of date.';
    // Being offline needs no action and gets no notice. Being offline for a
    // day with changes stranded does need one: sync has stopped working, and
    // Settings is the last place someone thinks to look for that. Without this
    // the only way to discover a device has fallen behind is to compare it
    // against another device and notice the difference.
    case 'offline':
      return isSyncStale(status)
        ? `Not synced for a while. ${status.pendingCount} local ${
            status.pendingCount === 1 ? 'change is' : 'changes are'
          } waiting — open Settings to sync.`
        : null;
    case 'session-expired':
      return status.pendingCount > 0
        ? `Sync paused. ${status.pendingCount} local ${
            status.pendingCount === 1 ? 'change is' : 'changes are'
          } safe and waiting.`
        : 'Sync paused. Sign in again to keep your devices up to date.';
    default:
      return null;
  }
}
