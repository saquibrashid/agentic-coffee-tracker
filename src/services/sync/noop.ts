/**
 * The engine used whenever sync is off: signed out, or unsupported by this
 * build.
 *
 * It is deliberately a working implementation of the full interface rather than
 * a throwing stub. Every caller — the status indicator, the settings panel, the
 * post-mutation trigger — can then be written once against `SyncEngine` and be
 * correct in v1, where the honest answer to "what is syncing?" is "nothing".
 */
import type { DeleteCloudDataResult, SyncEngine, SyncStatus } from './types';
import { DISABLED_STATUS, getSyncStatus, publishSyncStatus, subscribeSyncStatus } from './status';

export class NoopSyncEngine implements SyncEngine {
  /**
   * Asserts `disabled` on the shared store.
   *
   * A no-op for a fresh page, where the store already starts there — but not
   * after a re-selection (a sign-out, or `resetSyncEngineForTests`) has left an
   * earlier live engine's `idle` behind. The store is what the UI reads, so it
   * has to be corrected here rather than only in `status()`.
   */
  constructor() {
    publishSyncStatus(DISABLED_STATUS);
  }

  status(): SyncStatus {
    return getSyncStatus();
  }

  /**
   * Accepts subscribers and never calls them: a disabled engine has no state
   * changes to report, and nothing else publishes while it is the selected
   * engine. Returning a real unsubscribe function keeps effect cleanup
   * identical to the live engine, so the wiring is exercised in v1 rather than
   * being tried for the first time the day sync is switched on.
   */
  subscribe(fn: (status: SyncStatus) => void): () => void {
    return subscribeSyncStatus(fn);
  }

  sync(): Promise<void> {
    return Promise.resolve();
  }

  reset(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Nothing was ever uploaded, so nothing needs deleting. Reporting zeroes is
   * the truth here, and it lets the settings panel render the same confirmation
   * flow in every build rather than branching on which engine it got.
   */
  deleteCloudData(): Promise<DeleteCloudDataResult> {
    return Promise.resolve({ recordsDeleted: 0, photosDeleted: 0 });
  }
}
