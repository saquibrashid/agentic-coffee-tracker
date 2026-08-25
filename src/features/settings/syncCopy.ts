/**
 * Sync status copy, separate from the component so both can be tested and
 * reused without dragging React rendering into it.
 */
import type { SyncStatus } from '@/services/sync/types';
import { isSyncStale } from '@/services/sync/staleness';

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
      return offlineLine(status, relativeTo);
    case 'session-expired':
      return status.pendingCount > 0
        ? `Sign in again to sync ${status.pendingCount} pending ${
            status.pendingCount === 1 ? 'change' : 'changes'
          }.`
        : 'Sign in again to resume sync.';
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

/**
 * The offline line, which has to serve two very different situations.
 *
 * With nothing outstanding, or with recent changes waiting, offline is simply
 * true and reassurance is the honest answer. Once changes have been stranded
 * for a day it stops being reassurance and becomes a lie of omission, so the
 * line reports what is actually stuck and points at the button.
 *
 * The nudge toward Sync now is not filler. The most common way to reach this
 * state on a device that is plainly connected is a browser whose offline flag
 * has stuck, and pressing Sync now is what forces a real request past it.
 */
function offlineLine(status: SyncStatus, now: number): string {
  if (status.pendingCount === 0) return 'Offline — will sync when reconnected.';

  const changes = `${status.pendingCount} ${status.pendingCount === 1 ? 'change' : 'changes'}`;
  if (!isSyncStale(status, now)) return `Offline — ${changes} will sync when reconnected.`;

  const since = status.lastSyncedAt ? ` Last synced ${relativeTime(status.lastSyncedAt, now)}.` : '';
  return `${changes} still waiting to sync.${since} If this device is online, press Sync now.`;
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
