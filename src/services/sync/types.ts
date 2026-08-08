/**
 * The replication surface, specified in full by `specs/sync.md`.
 *
 * Phase 0 ships the interface and a no-op, so that call sites, status plumbing
 * and the settings UI can all be written and reviewed before a single byte
 * leaves the device.
 */

export type SyncState =
  /** Signed out, or sync unsupported in this build. The v1 default. */
  | 'disabled'
  /** Signed in, nothing to do. */
  | 'idle'
  /** A cycle is running. */
  | 'syncing'
  /** Cannot reach the server; local data is unaffected. */
  | 'offline'
  /** The last cycle failed. See `lastError`. */
  | 'error'
  /**
   * The server holds records written by a newer build than this one.
   * Halting is mandatory: applying them would silently downgrade a record.
   */
  | 'needs-upgrade';

export interface SyncStatus {
  state: SyncState;
  /** ISO 8601 of the last fully successful cycle, or null if never. */
  lastSyncedAt: string | null;
  /** Local changes waiting to be pushed. */
  pendingCount: number;
  lastError?: string;
}

export interface SyncEngine {
  /** The current status. Cheap and synchronous — safe to call during render. */
  status(): SyncStatus;
  /** Observes status changes. Returns an unsubscribe function. */
  subscribe(fn: (status: SyncStatus) => void): () => void;
  /** Runs one full pull -> merge -> push cycle. Never rejects; failures land in status. */
  sync(): Promise<void>;
  /** Clears the cursor and outbox, forcing a full re-pull on the next cycle. */
  reset(): Promise<void>;
}
