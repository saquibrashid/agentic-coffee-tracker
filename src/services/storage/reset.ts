import { db } from '@/services/db';

/**
 * Local-first apps own all of the user's data, so the user must be able to take
 * it all back. This module is the single place that knows every persistence
 * surface we touch: IndexedDB (Dexie), Cache Storage (the service worker
 * precache and runtime caches) and the service worker registration itself.
 *
 * If a new persistence mechanism is ever added, it has to be wired in here too,
 * or the privacy promise in the README stops being true.
 */

export interface StorageEstimateSummary {
  /** Bytes currently used by this origin, when the browser will tell us. */
  usageBytes: number | null;
  /** Total bytes the origin may use, when the browser will tell us. */
  quotaBytes: number | null;
  /** False when the Storage API is unavailable (Safari private mode, older browsers). */
  supported: boolean;
}

/**
 * The pieces of the platform `resetAllData` touches, injected so the reset path
 * can be tested without a real browser storage stack.
 */
export interface ResetEnvironment {
  deleteDatabase: () => Promise<void>;
  caches: CacheStorage | undefined;
  serviceWorker: ServiceWorkerContainer | undefined;
}

export interface ResetResult {
  databaseDeleted: boolean;
  cachesDeleted: number;
  serviceWorkersUnregistered: number;
  /** Non-fatal problems: a partial reset still beats no reset. */
  errors: string[];
}

function defaultEnvironment(): ResetEnvironment {
  return {
    deleteDatabase: async () => {
      // Close first; an open connection blocks deletion indefinitely in Chrome.
      db.close();
      await db.delete();
    },
    caches: typeof globalThis.caches === 'undefined' ? undefined : globalThis.caches,
    serviceWorker:
      typeof navigator === 'undefined' || !('serviceWorker' in navigator)
        ? undefined
        : navigator.serviceWorker,
  };
}

export async function getStorageEstimate(
  storage: StorageManager | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.storage,
): Promise<StorageEstimateSummary> {
  if (!storage || typeof storage.estimate !== 'function') {
    return { usageBytes: null, quotaBytes: null, supported: false };
  }
  try {
    const estimate = await storage.estimate();
    return {
      usageBytes: estimate.usage ?? null,
      quotaBytes: estimate.quota ?? null,
      supported: true,
    };
  } catch {
    return { usageBytes: null, quotaBytes: null, supported: false };
  }
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex] ?? 'KB'}`;
}

/**
 * Wipes every local persistence surface. Each step is independently guarded so
 * that a failure in one surface still lets the others complete — a partial
 * reset is recoverable by running it again, but aborting early would leave the
 * user believing their data was deleted when it was not.
 */
export async function resetAllData(
  env: ResetEnvironment = defaultEnvironment(),
): Promise<ResetResult> {
  const errors: string[] = [];
  let databaseDeleted = false;
  let cachesDeleted = 0;
  let serviceWorkersUnregistered = 0;

  try {
    await env.deleteDatabase();
    databaseDeleted = true;
  } catch (error) {
    errors.push(`Database: ${errorMessage(error)}`);
  }

  const cacheStorage = env.caches;
  if (cacheStorage) {
    try {
      const keys = await cacheStorage.keys();
      const results = await Promise.all(
        keys.map(async (key) => {
          try {
            return await cacheStorage.delete(key);
          } catch (error) {
            errors.push(`Cache "${key}": ${errorMessage(error)}`);
            return false;
          }
        }),
      );
      cachesDeleted = results.filter(Boolean).length;
    } catch (error) {
      errors.push(`Cache storage: ${errorMessage(error)}`);
    }
  }

  if (env.serviceWorker) {
    try {
      const registrations = await env.serviceWorker.getRegistrations();
      const results = await Promise.all(
        registrations.map(async (registration) => {
          try {
            return await registration.unregister();
          } catch (error) {
            errors.push(`Service worker: ${errorMessage(error)}`);
            return false;
          }
        }),
      );
      serviceWorkersUnregistered = results.filter(Boolean).length;
    } catch (error) {
      errors.push(`Service worker registrations: ${errorMessage(error)}`);
    }
  }

  return { databaseDeleted, cachesDeleted, serviceWorkersUnregistered, errors };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The user must type this exactly before the destructive action unlocks. */
export const RESET_CONFIRMATION_PHRASE = 'DELETE';
