import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DISABLED_STATUS,
  getSyncStatus,
  publishSyncStatus,
  resetSyncStatusForTests,
  subscribeSyncStatus,
} from './status';
import type { SyncStatus } from './types';

const IDLE: SyncStatus = { state: 'idle', lastSyncedAt: null, pendingCount: 0 };

describe('sync status store', () => {
  beforeEach(() => {
    resetSyncStatusForTests();
  });

  it('starts disabled, so a build without sync reports the truth before any engine exists', () => {
    expect(getSyncStatus()).toEqual({ state: 'disabled', lastSyncedAt: null, pendingCount: 0 });
  });

  it('hands every subscriber the published status', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeSyncStatus(a);
    subscribeSyncStatus(b);

    publishSyncStatus(IDLE);

    expect(a).toHaveBeenCalledWith(IDLE);
    expect(b).toHaveBeenCalledWith(IDLE);
  });

  it('stops notifying after unsubscribe', () => {
    const fn = vi.fn();
    const unsubscribe = subscribeSyncStatus(fn);

    unsubscribe();
    publishSyncStatus(IDLE);

    expect(fn).not.toHaveBeenCalled();
  });

  it('serves the latest status to a subscriber that arrives late', () => {
    publishSyncStatus(IDLE);

    // useSyncExternalStore reads the snapshot on render, which may be after the
    // engine has already published; a store that only pushed would leave that
    // subscriber on the pre-engine default.
    expect(getSyncStatus()).toEqual(IDLE);
  });

  it('changes identity on every publish', () => {
    // useSyncExternalStore bails out of a re-render when the snapshot is
    // reference-equal, so a mutated-in-place status would not repaint.
    publishSyncStatus(IDLE);
    const first = getSyncStatus();
    publishSyncStatus({ ...IDLE, state: 'syncing' });

    expect(getSyncStatus()).not.toBe(first);
  });

  it('freezes the disabled default it hands out repeatedly', () => {
    expect(Object.isFrozen(DISABLED_STATUS)).toBe(true);
  });
});

/**
 * The bundling guard for #137.
 *
 * The dynamic import of the engine in `App.tsx` was silently ineffective for as
 * long as the always-rendered status hook statically imported it, which put the
 * whole Cosmos-facing engine in the entry chunk for every visitor. Rollup never
 * warned; Rolldown does, but a warning does not fail a build. This asserts the
 * property directly against the source graph, so the regression is caught by
 * `pnpm test` rather than by someone reading build output.
 */
describe('entry-chunk isolation', () => {
  // Read through Vite rather than node:fs: this file is part of the app
  // project, whose tsconfig deliberately withholds Node types so production
  // source cannot reach for the filesystem.
  const sources = import.meta.glob('./*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  function localImports(file: string): string[] {
    const source = sources[`./${file}`];
    if (source === undefined) throw new Error(`no source for ${file}`);
    return [...source.matchAll(/^\s*import\s+(?:type\s+)?[^'"]*from\s+'(\.[^']+)'/gm)]
      .map((m) => m[1])
      .filter((specifier): specifier is string => specifier !== undefined);
  }

  function reachable(entry: string, seen = new Set<string>()): Set<string> {
    if (seen.has(entry)) return seen;
    seen.add(entry);
    for (const specifier of localImports(entry)) {
      reachable(specifier.replace(/^\.\//, '') + '.ts', seen);
    }
    return seen;
  }

  it("keeps the engine out of the status hook's import graph", () => {
    const graph = reachable('useSyncStatus.ts');

    expect(graph).toContain('status.ts');
    expect(graph).not.toContain('cloud.ts');
    expect(graph).not.toContain('index.ts');
    expect(graph).not.toContain('outbox.ts');
    expect(graph).not.toContain('api.ts');
  });
});
