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

const DISABLED: SyncStatus = Object.freeze({
  state: 'disabled',
  lastSyncedAt: null,
  pendingCount: 0,
});

export class NoopSyncEngine implements SyncEngine {
  status(): SyncStatus {
    return DISABLED;
  }

  /**
   * Accepts subscribers and never calls them: a disabled engine has no state
   * changes to report. Returning a real unsubscribe function keeps effect
   * cleanup identical to the live engine, so the wiring is exercised in v1
   * rather than first being tried the day sync is switched on.
   */
  subscribe(_fn: (status: SyncStatus) => void): () => void {
    return () => {};
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
