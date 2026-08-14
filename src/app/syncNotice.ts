import type { SyncStatus } from '@/services/sync/types';

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
    default:
      return null;
  }
}
