import { describe, it, expect, vi } from 'vitest';
import { formatBytes, getStorageEstimate, resetAllData, type ResetEnvironment } from './reset';

function fakeCaches(keys: string[], onDelete?: (key: string) => Promise<boolean>): CacheStorage {
  return {
    keys: vi.fn(async () => keys),
    delete: vi.fn(async (key: string) => (onDelete ? onDelete(key) : true)),
  } as unknown as CacheStorage;
}

function fakeServiceWorker(
  registrations: Array<{ unregister: () => Promise<boolean> }>,
): ServiceWorkerContainer {
  return {
    getRegistrations: vi.fn(async () => registrations),
  } as unknown as ServiceWorkerContainer;
}

function environment(overrides: Partial<ResetEnvironment> = {}): ResetEnvironment {
  return {
    deleteDatabase: vi.fn(async () => {}),
    caches: fakeCaches([]),
    serviceWorker: fakeServiceWorker([]),
    ...overrides,
  };
}

describe('formatBytes', () => {
  it('reports raw bytes below 1 KB', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('scales through the unit ladder', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });

  it('drops the decimal once the value is large enough not to need it', () => {
    expect(formatBytes(64 * 1024 * 1024)).toBe('64 MB');
  });

  it('says "unknown" rather than "0 B" when the browser withholds the number', () => {
    expect(formatBytes(null)).toBe('unknown');
  });
});

describe('getStorageEstimate', () => {
  it('reports unsupported when the Storage API is missing', async () => {
    await expect(getStorageEstimate(undefined)).resolves.toEqual({
      usageBytes: null,
      quotaBytes: null,
      supported: false,
    });
  });

  it('returns the browser estimate when available', async () => {
    const storage = { estimate: async () => ({ usage: 1000, quota: 5000 }) } as StorageManager;
    await expect(getStorageEstimate(storage)).resolves.toEqual({
      usageBytes: 1000,
      quotaBytes: 5000,
      supported: true,
    });
  });

  it('degrades to unsupported when estimate() throws (private browsing)', async () => {
    const storage = {
      estimate: async () => {
        throw new Error('denied');
      },
    } as unknown as StorageManager;
    const result = await getStorageEstimate(storage);
    expect(result.supported).toBe(false);
  });
});

describe('resetAllData', () => {
  it('clears the database, every cache and every service worker registration', async () => {
    const unregister = vi.fn(async () => true);
    const env = environment({
      caches: fakeCaches(['precache-v1', 'runtime']),
      serviceWorker: fakeServiceWorker([{ unregister }, { unregister }]),
    });

    const result = await resetAllData(env);

    expect(env.deleteDatabase).toHaveBeenCalledOnce();
    expect(result).toEqual({
      databaseDeleted: true,
      cachesDeleted: 2,
      serviceWorkersUnregistered: 2,
      errors: [],
    });
  });

  it('still clears caches and workers when the database delete fails', async () => {
    // A partial reset the user can retry is far better than aborting on the
    // first error and leaving stale caches behind.
    const env = environment({
      deleteDatabase: vi.fn(async () => {
        throw new Error('blocked by another tab');
      }),
      caches: fakeCaches(['runtime']),
      serviceWorker: fakeServiceWorker([{ unregister: async () => true }]),
    });

    const result = await resetAllData(env);

    expect(result.databaseDeleted).toBe(false);
    expect(result.cachesDeleted).toBe(1);
    expect(result.serviceWorkersUnregistered).toBe(1);
    expect(result.errors).toEqual(['Database: blocked by another tab']);
  });

  it('records a per-cache failure without losing the other caches', async () => {
    const env = environment({
      caches: fakeCaches(['good', 'bad'], async (key) => {
        if (key === 'bad') throw new Error('locked');
        return true;
      }),
    });

    const result = await resetAllData(env);

    expect(result.cachesDeleted).toBe(1);
    expect(result.errors).toEqual(['Cache "bad": locked']);
  });

  it('works in environments with no Cache Storage or service worker support', async () => {
    const env = environment({ caches: undefined, serviceWorker: undefined });

    const result = await resetAllData(env);

    expect(result).toEqual({
      databaseDeleted: true,
      cachesDeleted: 0,
      serviceWorkersUnregistered: 0,
      errors: [],
    });
  });
});
