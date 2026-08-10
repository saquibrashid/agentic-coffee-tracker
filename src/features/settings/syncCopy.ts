/**
 * Sync status copy, separate from the component so both can be tested and
 * reused without dragging React rendering into it.
 */
import type { SyncStatus } from '@/services/sync/types';

/**
 * Typing the word is the point: it is the difference between an action taken
 * and an action stumbled into, and unlike the local reset this one cannot be
 * undone by re-syncing from another device.
 */
export const DELETE_CLOUD_PHRASE = 'DELETE CLOUD DATA';

/**
 * The status line.
 *
 * Deliberately never "Everything is fine" — the useful states are the ones
 * where something is outstanding, and a permanent reassurance is exactly what
 * trains people to stop reading.
 */
export function describeSync(status: SyncStatus, relativeTo: number = Date.now()): string {
  switch (status.state) {
    case 'disabled':
      return 'Sync is off. Your coffees stay on this device.';
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return 'Offline — will sync when reconnected.';
    case 'needs-upgrade':
      return 'This version is out of date. Refresh to continue syncing.';
    case 'error':
      return status.lastError ?? 'Sync failed. It will retry automatically.';
    case 'idle':
      if (status.pendingCount > 0) {
        return `${status.pendingCount} ${status.pendingCount === 1 ? 'change' : 'changes'} pending.`;
      }
      return status.lastSyncedAt
        ? `Synced ${relativeTime(status.lastSyncedAt, relativeTo)}.`
        : 'Not synced yet.';
  }
}

function relativeTime(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
