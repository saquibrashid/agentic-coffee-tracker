import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CloudSyncEngine,
  getSyncEngine,
  isSyncSupported,
  NoopSyncEngine,
  resetSyncEngineForTests,
} from './index';

afterEach(() => {
  vi.unstubAllEnvs();
  resetSyncEngineForTests();
});

describe('NoopSyncEngine', () => {
  const engine = new NoopSyncEngine();

  it('reports sync as disabled with nothing pending', () => {
    expect(engine.status()).toEqual({
      state: 'disabled',
      lastSyncedAt: null,
      pendingCount: 0,
    });
  });

  it('accepts subscribers and never notifies them', async () => {
    const seen = vi.fn();
    const unsubscribe = engine.subscribe(seen);

    await engine.sync();
    await engine.reset();

    // A disabled engine has no state changes to report. Publishing a spurious
    // update would make every subscriber re-render for nothing.
    expect(seen).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('returns an unsubscribe that is safe to call twice', () => {
    const unsubscribe = engine.subscribe(vi.fn());
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('resolves sync and reset without doing anything', async () => {
    await expect(engine.sync()).resolves.toBeUndefined();
    await expect(engine.reset()).resolves.toBeUndefined();
  });

  it('reports zero deleted, because nothing was ever uploaded', async () => {
    // A working implementation rather than a throwing stub: the settings panel
    // renders the same confirmation flow in every build instead of branching on
    // which engine it happened to get.
    await expect(engine.deleteCloudData()).resolves.toEqual({
      recordsDeleted: 0,
      photosDeleted: 0,
    });
  });
});

describe('isSyncSupported', () => {
  it('allows sync on the SWA linked backend with sign-in available', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');
    expect(isSyncSupported()).toBe(true);
  });

  it('refuses to sync when the client calls the Function App directly', () => {
    // specs/sync.md treats this as blocking. In that topology the
    // x-ms-client-principal header is attacker-supplied rather than injected by
    // Static Web Apps, so a forged principal would read another user's data.
    vi.stubEnv('VITE_API_BASE_URL', 'https://func-coffee.azurewebsites.net');
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');
    expect(isSyncSupported()).toBe(false);
  });

  it('refuses to sync when sign-in is unavailable', () => {
    // Sync with no signed-in user has no partition to write to, so an engine
    // that could never authenticate would just generate 401s on a timer.
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_AUTH_ENABLED', 'false');
    expect(isSyncSupported()).toBe(false);
  });
});

describe('getSyncEngine', () => {
  it('returns the same instance every time', () => {
    // Subscribers must all observe one status, and the real engine holds a
    // cursor and a Web Lock that must not be duplicated across re-renders.
    expect(getSyncEngine()).toBe(getSyncEngine());
  });

  it('is a no-op engine when sign-in is unavailable', () => {
    expect(getSyncEngine()).toBeInstanceOf(NoopSyncEngine);
  });

  it('selects the live engine once the topology can be trusted', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');
    expect(getSyncEngine()).toBeInstanceOf(CloudSyncEngine);
  });

  it('stays disabled even in the untrusted topology', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://func-coffee.azurewebsites.net');
    vi.stubEnv('VITE_AUTH_ENABLED', 'true');
    expect(getSyncEngine().status().state).toBe('disabled');
  });
});
