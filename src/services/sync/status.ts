/**
 * The sync status store: the one piece of the sync surface that the app shell
 * needs on every page load.
 *
 * It exists as its own module for a bundling reason, not a design-purity one.
 * The status indicator in the chrome renders on first paint, so whatever it
 * imports lands in the entry chunk. When that was `getSyncEngine()`, the entry
 * chunk pulled in `CloudSyncEngine` and everything behind it — the Dexie
 * outbox, the API client, the photo uploader — for every visitor, including the
 * signed-out ones who can never run any of it. Splitting the *state* away from
 * the code that *mutates* it lets the engine stay behind `App.tsx`'s dynamic
 * import while the indicator still updates the moment that import lands.
 *
 * Deliberately a module-level singleton rather than React context: the engine
 * publishes from timers and event handlers that have no component to hang off,
 * and every subscriber must observe the same status regardless of where it sits
 * in the tree.
 */
import type { SyncStatus } from './types';

/**
 * The pre-engine status, and the permanent one in builds where sync is
 * unsupported. Frozen because it is handed to every subscriber before the first
 * publish, and `useSyncExternalStore` treats a changed reference as a change.
 */
export const DISABLED_STATUS: SyncStatus = Object.freeze({
  state: 'disabled',
  lastSyncedAt: null,
  pendingCount: 0,
});

let current: SyncStatus = DISABLED_STATUS;
const subscribers = new Set<(status: SyncStatus) => void>();

/** The current status. Cheap and synchronous — safe to call during render. */
export function getSyncStatus(): SyncStatus {
  return current;
}

/** Observes status changes. Returns an unsubscribe function. */
export function subscribeSyncStatus(fn: (status: SyncStatus) => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Replaces the status and notifies subscribers. Called by the engine only.
 *
 * The reference must change on every publish for `useSyncExternalStore` to
 * re-render, which is why the engine builds a fresh object rather than mutating
 * the one it was given.
 */
export function publishSyncStatus(next: SyncStatus): void {
  current = next;
  for (const fn of subscribers) fn(next);
}

/**
 * Test seam: returns the store to its pre-engine state.
 *
 * Subscribers are dropped as well as the status — a listener left over from a
 * previous test would otherwise keep firing against a torn-down engine.
 */
export function resetSyncStatusForTests(): void {
  current = DISABLED_STATUS;
  subscribers.clear();
}
