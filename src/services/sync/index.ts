/**
 * Chooses the sync engine for this build, and owns the security gate that
 * decides whether one may run at all.
 */
import { NoopSyncEngine } from './noop';
import type { SyncEngine } from './types';
import { isLinkedBackendTopology } from '../platform/topology';

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
 * a live engine cannot be selected by accident once one exists.
 */
export function isSyncSupported(): boolean {
  return isLinkedBackendTopology();
}

let engine: SyncEngine | null = null;

/**
 * The process-wide engine.
 *
 * A singleton because subscribers must all observe the same status, and because
 * the real engine will hold a cursor and a Web Lock that must not be duplicated
 * across React re-renders.
 */
export function getSyncEngine(): SyncEngine {
  // Every future engine has to be selected here, behind isSyncSupported(), so
  // the gate above cannot be bypassed by a caller constructing one directly.
  engine ??= new NoopSyncEngine();
  return engine;
}

/** Test seam: drops the cached engine so the next call re-selects. */
export function resetSyncEngineForTests(): void {
  engine = null;
}

export { NoopSyncEngine } from './noop';
export type { SyncEngine, SyncState, SyncStatus } from './types';
