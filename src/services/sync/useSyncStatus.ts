import { useSyncExternalStore } from 'react';

import { getSyncStatus, subscribeSyncStatus } from './status';
import type { SyncStatus } from './types';

/**
 * Subscribes the component tree to sync status.
 *
 * Reads the shared store rather than the engine, and that indirection is
 * load-bearing: this hook renders in the app shell on first paint, so importing
 * `getSyncEngine()` here would put the entire Cosmos-facing engine into the
 * entry chunk and defeat the dynamic import in `App.tsx` (#137).
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` because the
 * engine now arrives asynchronously: a publish landing between the initial
 * render and the subscribe effect would be dropped by the manual pairing, and
 * the indicator would then sit on a stale status until the next publish — which
 * for a healthy idle engine is five minutes away.
 */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
}
