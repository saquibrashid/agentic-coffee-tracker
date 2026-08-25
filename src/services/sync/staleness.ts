/**
 * When "offline" stops being routine and starts being a problem.
 *
 * Being offline is a normal state for this app, not a failure, so it must not
 * nag: a phone on a plane with three edits waiting is working exactly as
 * designed. But the same status line is also what a device shows when sync has
 * silently stopped working, and there it is actively misleading — "will sync
 * when reconnected" reassures the user that no action is needed, which is why
 * a broken device can go unnoticed until its data is compared against another
 * one.
 *
 * The two cases are indistinguishable from a single status snapshot. What
 * separates them is duration: an outage measured in hours is a tunnel, and one
 * measured in days is a fault.
 */
import type { SyncStatus } from './types';

/**
 * A day. Long enough that ordinary disconnection — a flight, a commute, a
 * weekend somewhere with no signal — never trips it, so that when it does trip
 * it means something.
 */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * True when work is waiting and has been waiting long enough to be worth
 * mentioning.
 *
 * Requires a known `lastSyncedAt`. A device that has never synced at all is
 * deliberately not called stale: it has no history to be measured against, and
 * the most likely reason is that it was set up moments ago and is offline right
 * now — which is precisely the case that should stay quiet.
 */
export function isSyncStale(status: SyncStatus, now: number = Date.now()): boolean {
  if (status.pendingCount === 0) return false;
  if (!status.lastSyncedAt) return false;
  return now - new Date(status.lastSyncedAt).getTime() >= STALE_AFTER_MS;
}
