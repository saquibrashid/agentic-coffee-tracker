import { useEffect, useState } from 'react';

import { getSyncEngine } from './index';
import type { SyncStatus } from './types';

/**
 * Subscribes the component tree to sync status.
 *
 * Live in v1 even though `NoopSyncEngine` never publishes: running the real
 * subscribe/unsubscribe lifecycle now means the wiring is exercised by every
 * mount and unmount from day one, instead of being tried for the first time on
 * the day a live engine is switched on.
 */
export function useSyncStatus(): SyncStatus {
  const engine = getSyncEngine();
  const [status, setStatus] = useState<SyncStatus>(() => engine.status());

  useEffect(() => engine.subscribe(setStatus), [engine]);

  return status;
}
