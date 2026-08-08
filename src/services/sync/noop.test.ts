import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSyncEngine, isSyncSupported, NoopSyncEngine, resetSyncEngineForTests } from './index';

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
});

describe('isSyncSupported', () => {
  it('allows sync when the client goes through the SWA linked backend', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    expect(isSyncSupported()).toBe(true);
  });

  it('refuses to sync when the client calls the Function App directly', () => {
    // specs/sync.md treats this as blocking. In that topology the
    // x-ms-client-principal header is attacker-supplied rather than injected by
    // Static Web Apps, so a forged principal would read another user's data.
    vi.stubEnv('VITE_API_BASE_URL', 'https://func-coffee.azurewebsites.net');
    expect(isSyncSupported()).toBe(false);
  });
});

describe('getSyncEngine', () => {
  it('returns the same instance every time', () => {
    // Subscribers must all observe one status, and the real engine will hold a
    // cursor and a Web Lock that must not be duplicated across re-renders.
    expect(getSyncEngine()).toBe(getSyncEngine());
  });

  it('is a no-op engine in this build', () => {
    expect(getSyncEngine()).toBeInstanceOf(NoopSyncEngine);
  });

  it('stays disabled even in the untrusted topology', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://func-coffee.azurewebsites.net');
    expect(getSyncEngine().status().state).toBe('disabled');
  });
});
