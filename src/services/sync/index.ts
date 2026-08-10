/**
 * Chooses the sync engine for this build, and owns the security gate that
 * decides whether one may run at all.
 */
import { CloudSyncEngine } from './cloud';
import { NoopSyncEngine } from './noop';
import type { SyncEngine } from './types';
import { isLinkedBackendTopology } from '../platform/topology';
import { isAuthSupported } from '../auth';

/**
 * Whether this build is allowed to sync.
 *
 * `specs/sync.md` → Identity treats this as blocking. Sync trusts the
 * `x-ms-client-principal` header that Static Web Apps injects, and that header
 * is only trustworthy when the Functions app is reachable *exclusively* through
 * the SWA linked backend. Setting `VITE_API_BASE_URL` points the client at the
 * Function App directly, which is a supported Free-tier topology — and in it
 * the header is attacker-supplied, so a forged principal would read any user's
 * data.
 *
 * Until the sync endpoints validate the SWA access token themselves, the only
 * safe answer in that topology is to refuse to sync. Failing closed here means
 * a live engine cannot be selected by accident.
 *
 * Auth support is required too, and not merely implied by the topology: sync
 * with no signed-in user has no partition key to write to, so an engine that
 * could never authenticate would just generate 401s on a timer.
 */
export function isSyncSupported(): boolean {
  return isLinkedBackendTopology() && isAuthSupported();
}

let engine: SyncEngine | null = null;

/**
 * The process-wide engine.
 *
 * A singleton because subscribers must all observe the same status, and because
 * the real engine holds a cursor and a Web Lock that must not be duplicated
 * across React re-renders.
 */
export function getSyncEngine(): SyncEngine {
  // Every engine is selected here, behind isSyncSupported(), so the gate above
  // cannot be bypassed by a caller constructing one directly.
  engine ??= isSyncSupported() ? new CloudSyncEngine() : new NoopSyncEngine();
  return engine;
}

/** Starts the live engine's triggers. No-op when sync is unsupported. */
export function startSyncEngine(): void {
  const current = getSyncEngine();
  if (current instanceof CloudSyncEngine) current.start();
}

/** Test seam: drops the cached engine so the next call re-selects. */
export function resetSyncEngineForTests(): void {
  engine = null;
}

export { CloudSyncEngine } from './cloud';
export { NoopSyncEngine } from './noop';
export type { SyncEngine, SyncState, SyncStatus } from './types';
