import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean } from '@/types';

import {
  PhotoQuotaError,
  SyncApiError,
  SyncTimeoutError,
  type PullResponse,
  type PushResponse,
} from './api';
import { CloudSyncEngine } from './cloud';
import { enqueueDelete, enqueueUpsert } from './outbox';
import { getCursor, setCursor } from './state';

import type * as syncApi from './api';
import type * as syncPhotos from './photos';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof syncApi>('./api');
  return { ...actual, pull: vi.fn(), push: vi.fn() };
});

vi.mock('@/services/preferences/compute', () => ({ refreshPreferences: vi.fn() }));

vi.mock('./photos', async () => {
  const actual = await vi.importActual<typeof syncPhotos>('./photos');
  return { ...actual, uploadPhoto: vi.fn(), backfillPhotos: vi.fn() };
});

const api = await import('./api');
const photos = await import('./photos');
const { refreshPreferences } = await import('@/services/preferences/compute');
const pull = vi.mocked(api.pull);
const push = vi.mocked(api.push);
const uploadPhoto = vi.mocked(photos.uploadPhoto);
const backfillPhotos = vi.mocked(photos.backfillPhotos);

const NOW = '2026-01-02T00:00:00.000Z';

/**
 * Fakes only the timer APIs the engine itself uses.
 *
 * The default `useFakeTimers()` also fakes `setImmediate`, which fake-indexeddb
 * schedules its transaction processing on — faking it deadlocks every Dexie
 * call in the test, including the status publish at the start of a cycle.
 */
function useEngineTimers(): void {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  vi.setSystemTime(new Date(NOW));
}

function emptyPull(cursor = 0, hasMore = false): PullResponse {
  return { records: [], cursor, hasMore };
}

function pushOk(cursor = 0): PushResponse {
  return { cursor, results: [] };
}

function bean(id: string): CoffeeBean {
  return {
    id,
    schemaVersion: 1,
    roaster: 'Anchorhead',
    name: `Bean ${id}`,
    isArchived: false,
    needsReview: false,
    createdAt: NOW,
    updatedAt: NOW,
  } as CoffeeBean;
}

let engine: CloudSyncEngine;

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([db.beans.clear(), db.ratings.clear(), db.photos.clear(), db.outbox.clear()]);
  await db.meta.clear();
  pull.mockResolvedValue(emptyPull());
  push.mockResolvedValue(pushOk());
  uploadPhoto.mockResolvedValue({ used: 0, limit: 500 * 1024 * 1024 });
  backfillPhotos.mockResolvedValue(0);
  engine = new CloudSyncEngine();
});

afterEach(() => {
  engine.stop();
  vi.useRealTimers();
  // Restores the navigator.onLine spy: leaving it in place makes every later
  // test think the browser is offline, and the engine correctly refuses to sync.
  vi.restoreAllMocks();
});

describe('the sync cycle', () => {
  it('pulls before it pushes', async () => {
    // Not cosmetic: pushing first lets a device overwrite remote changes it has
    // not yet merged, which defeats the conflict policy entirely.
    const order: string[] = [];
    pull.mockImplementation(() => {
      order.push('pull');
      return Promise.resolve(emptyPull());
    });
    push.mockImplementation(() => {
      order.push('push');
      return Promise.resolve(pushOk());
    });
    await db.beans.put(bean('bean-1'));
    await enqueueUpsert('bean', 'bean-1');

    await engine.sync();

    expect(order).toEqual(['pull', 'push']);
  });

  it('reaches idle and records when it last succeeded', async () => {
    await engine.sync();

    expect(engine.status().state).toBe('idle');
    expect(engine.status().lastSyncedAt).not.toBeNull();
  });

  it('sends the stored cursor and stores the one it gets back', async () => {
    await setCursor(17);
    pull.mockResolvedValue(emptyPull(42));

    await engine.sync();

    expect(pull).toHaveBeenCalledWith(17);
    expect(await getCursor()).toBe(42);
  });

  it('keeps pulling while the server reports more pages', async () => {
    pull
      .mockResolvedValueOnce(emptyPull(1, true))
      .mockResolvedValueOnce(emptyPull(2, true))
      .mockResolvedValueOnce(emptyPull(3, false));

    await engine.sync();

    expect(pull).toHaveBeenCalledTimes(3);
    expect(pull).toHaveBeenLastCalledWith(2);
    expect(await getCursor()).toBe(3);
  });

  it('recomputes preferences when a pull changed beans or ratings', async () => {
    pull.mockResolvedValue({
      records: [
        {
          id: 'bean:bean-9',
          userId: 'u',
          type: 'bean',
          recordId: 'bean-9',
          seq: 1,
          updatedAt: NOW,
          deleted: false,
          schemaVersion: 1,
          deviceId: 'other',
          payload: bean('bean-9'),
        },
      ],
      cursor: 1,
      hasMore: false,
    });

    await engine.sync();

    expect(refreshPreferences).toHaveBeenCalled();
  });

  it('does not recompute preferences when nothing arrived', async () => {
    await engine.sync();

    expect(refreshPreferences).not.toHaveBeenCalled();
  });

  it('does not call push when the outbox is empty', async () => {
    await engine.sync();

    expect(push).not.toHaveBeenCalled();
  });

  it('backfills photo bytes after a successful cycle', async () => {
    await engine.sync();

    expect(backfillPhotos).toHaveBeenCalled();
  });

  it('reports a healthy cycle even when backfill fails', async () => {
    // Bytes are cosmetic next to records; a photo service that is down must not
    // make a fully successful record sync look broken.
    backfillPhotos.mockRejectedValue(new Error('storage down'));

    await engine.sync();

    expect(engine.status().state).toBe('idle');
  });
});

describe('pushing queued work', () => {
  it('sends the record as it stands now, not as it was when queued', async () => {
    // Entries deliberately carry no snapshot, so an edit made after queuing
    // still goes out on the first push rather than pushing a stale copy.
    await db.beans.put(bean('bean-1'));
    await enqueueUpsert('bean', 'bean-1');
    await db.beans.put({ ...bean('bean-1'), roaster: 'Edited later' });

    await engine.sync();

    const [, records] = push.mock.calls[0]!;
    expect(records[0]?.payload).toMatchObject({ roaster: 'Edited later' });
  });

  it('clears the outbox once the server accepts the batch', async () => {
    await db.beans.put(bean('bean-1'));
    await enqueueUpsert('bean', 'bean-1');

    await engine.sync();

    expect(await db.outbox.count()).toBe(0);
  });

  it('sends a tombstone for a deleted record', async () => {
    await enqueueDelete('bean', 'bean-1', NOW);

    await engine.sync();

    const [, records] = push.mock.calls[0]!;
    expect(records[0]).toMatchObject({ recordId: 'bean-1', deleted: true, payload: null });
  });

  it('uploads photo bytes before the metadata record, and never in it', async () => {
    // Blobs go to Blob Storage: putting them in the record stream would blow
    // past the document size limit on the first real photo. And the order is
    // load-bearing — metadata first publishes a pointer to bytes that are not
    // there yet, and every device pulling in that window shows a broken photo.
    const order: string[] = [];
    uploadPhoto.mockImplementation(async () => {
      order.push('upload');
      return { used: 0, limit: 500 * 1024 * 1024 };
    });
    push.mockImplementation(async () => {
      order.push('push');
      return pushOk();
    });

    await db.photos.put({
      id: 'photo-1',
      schemaVersion: 1,
      kind: 'bag',
      blob: new Blob(['bytes']),
      createdAt: NOW,
    } as never);
    await enqueueUpsert('photo', 'photo-1');

    await engine.sync();

    expect(order).toEqual(['upload', 'push']);
    const [, records] = push.mock.calls[0]!;
    expect(records[0]?.payload).not.toHaveProperty('blob');
  });

  it('keeps syncing records when photo storage is full', async () => {
    uploadPhoto.mockRejectedValue(new PhotoQuotaError({ used: 500, limit: 500 }));
    await db.photos.put({
      id: 'photo-1',
      schemaVersion: 1,
      kind: 'bag',
      blob: new Blob(['bytes']),
      createdAt: NOW,
    } as never);
    await db.beans.put(bean('bean-1'));
    await enqueueUpsert('photo', 'photo-1');
    await enqueueUpsert('bean', 'bean-1');

    await engine.sync();

    // A full quota is a condition to report, not a failed cycle: the bean still
    // reaches the server and the status stays healthy.
    const [, records] = push.mock.calls[0]!;
    expect(records.map((r) => r.recordId)).toEqual(['bean-1']);
    expect(engine.status().state).toBe('idle');
    expect(engine.status().photoQuota).toEqual({ used: 500, limit: 500, exceeded: true });
  });

  it('leaves a refused photo queued for a later cycle', async () => {
    uploadPhoto.mockRejectedValue(new PhotoQuotaError({ used: 500, limit: 500 }));
    await db.photos.put({
      id: 'photo-1',
      schemaVersion: 1,
      kind: 'bag',
      blob: new Blob(['bytes']),
      createdAt: NOW,
    } as never);
    await enqueueUpsert('photo', 'photo-1');

    await engine.sync();

    // Dropping it would lose the photo permanently; the user frees space and it
    // syncs on the next cycle.
    expect(await db.outbox.count()).toBe(1);
  });

  it('drops an upsert whose record no longer exists', async () => {
    // The record was deleted after being queued; that delete carries its own
    // entry, so there is nothing to send and nothing to retry.
    await enqueueUpsert('bean', 'ghost');

    await engine.sync();

    expect(push).not.toHaveBeenCalled();
    expect(await db.outbox.count()).toBe(0);
  });

  it('keeps the entry and records why when the push fails', async () => {
    await db.beans.put(bean('bean-1'));
    await enqueueUpsert('bean', 'bean-1');
    push.mockRejectedValue(new SyncApiError({ status: 503, message: 'unavailable' }));

    await engine.sync();

    expect(await db.outbox.count()).toBe(1);
    expect((await db.outbox.toArray())[0]?.lastError).toBe('unavailable');
  });
});

describe('failure handling', () => {
  it('backs off exponentially and stops trying until the delay elapses', async () => {
    useEngineTimers();
    pull.mockRejectedValue(new SyncApiError({ status: 500, message: 'boom' }));

    await engine.sync();
    expect(engine.status().state).toBe('error');
    expect(pull).toHaveBeenCalledTimes(1);

    // Inside the first 60s window the cycle is skipped outright.
    vi.advanceTimersByTime(59_000);
    await engine.sync();
    expect(pull).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    await engine.sync();
    expect(pull).toHaveBeenCalledTimes(2);

    // Second failure doubles the wait, so 60s is no longer enough.
    vi.advanceTimersByTime(61_000);
    await engine.sync();
    expect(pull).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(60_000);
    await engine.sync();
    expect(pull).toHaveBeenCalledTimes(3);
  });

  it('gives up after eight consecutive failures', async () => {
    useEngineTimers();
    pull.mockRejectedValue(new SyncApiError({ status: 500, message: 'boom' }));

    for (let i = 0; i < 8; i++) {
      await engine.sync();
      vi.advanceTimersByTime(60 * 60 * 1000);
    }

    expect(pull).toHaveBeenCalledTimes(8);
    expect(engine.status().lastError).toContain('Sync failed 8 times');

    // Halted: further triggers do nothing at all until the user acts.
    await engine.sync();
    expect(pull).toHaveBeenCalledTimes(8);
  });

  it('stops immediately on an expired session rather than retrying forever', async () => {
    pull.mockRejectedValue(new SyncApiError({ status: 401, message: 'unauthorized' }));

    await engine.sync();
    await engine.sync();

    expect(pull).toHaveBeenCalledTimes(1);
    expect(engine.status()).toMatchObject({ state: 'error', lastError: 'unauthorized' });
  });

  it('stops on a rejected request this build will never get right', async () => {
    pull.mockRejectedValue(new SyncApiError({ status: 400, message: 'bad request' }));

    await engine.sync();
    await engine.sync();

    expect(pull).toHaveBeenCalledTimes(1);
  });

  it('retries contention from another device', async () => {
    pull.mockRejectedValueOnce(new SyncApiError({ status: 409, message: 'conflict' }));

    await engine.sync();
    expect(engine.status().state).toBe('error');

    engine.resume();
    await engine.sync();
    expect(engine.status().state).toBe('idle');
  });

  it('reports a timeout as offline, not as an error', async () => {
    // Local data is untouched and the app is fully usable, so a dropped
    // connection must not be dressed up as a failure.
    pull.mockRejectedValue(new SyncTimeoutError('/api/sync/pull'));

    await engine.sync();

    expect(engine.status().state).toBe('offline');
  });

  it('halts and asks for a refresh when the server sends a newer schema', async () => {
    pull.mockResolvedValue({
      records: [
        {
          id: 'bean:bean-1',
          userId: 'u',
          type: 'bean',
          recordId: 'bean-1',
          seq: 1,
          updatedAt: NOW,
          deleted: false,
          schemaVersion: 99,
          deviceId: 'other',
          payload: bean('bean-1'),
        },
      ],
      cursor: 1,
      hasMore: false,
    });

    await engine.sync();

    expect(engine.status().state).toBe('needs-upgrade');
    // The cursor must not advance past a batch that was never applied.
    expect(await getCursor()).toBe(0);

    await engine.sync();
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it('clears the halt when the user retries', async () => {
    pull.mockRejectedValueOnce(new SyncApiError({ status: 401, message: 'unauthorized' }));

    await engine.sync();
    engine.resume();
    await engine.sync();

    expect(engine.status().state).toBe('idle');
  });

  it('does not leave a stale error message on the next success', async () => {
    pull.mockRejectedValueOnce(new SyncApiError({ status: 500, message: 'boom' }));
    await engine.sync();
    expect(engine.status().lastError).toBe('boom');

    engine.resume();
    await engine.sync();

    expect(engine.status().lastError).toBeUndefined();
  });
});

describe('triggers and coalescing', () => {
  it('runs one cycle when two triggers fire at once', async () => {
    let release: (value: PullResponse) => void = () => {};
    pull.mockReturnValue(
      new Promise<PullResponse>((resolve) => {
        release = resolve;
      }),
    );

    const first = engine.sync();
    const second = engine.sync();
    release(emptyPull());
    await Promise.all([first, second]);

    expect(pull).toHaveBeenCalledTimes(1);
  });

  it('does not touch the network while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    await engine.sync();

    expect(pull).not.toHaveBeenCalled();
    expect(engine.status().state).toBe('offline');
  });

  it('syncs as soon as the tab starts', async () => {
    engine.start();
    await vi.waitFor(() => expect(pull).toHaveBeenCalledTimes(1));
  });

  it('coalesces a burst of mutations into a single cycle', async () => {
    // A bulk import writes hundreds of rows; one cycle per row would be a
    // self-inflicted denial of service on our own endpoint.
    useEngineTimers();
    engine.start();
    await vi.waitFor(() => expect(pull).toHaveBeenCalledTimes(1));

    for (let i = 0; i < 50; i++) engine.notifyMutation();
    await vi.advanceTimersByTimeAsync(5_000);

    // The debounce fires synchronously, but the cycle behind it awaits Dexie,
    // which runs on real (unfaked) scheduling — so the call lands a tick later.
    await vi.waitFor(() => expect(pull).toHaveBeenCalledTimes(2));
  });

  it('ignores mutations once stopped', async () => {
    useEngineTimers();
    engine.start();
    await vi.waitFor(() => expect(pull).toHaveBeenCalledTimes(1));

    engine.stop();
    engine.notifyMutation();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(pull).toHaveBeenCalledTimes(1);
  });

  it('retries straight away when the connection comes back', async () => {
    pull.mockRejectedValueOnce(new SyncTimeoutError('/api/sync/pull'));
    engine.start();
    await vi.waitFor(() => expect(engine.status().state).toBe('offline'));

    // Backoff is deliberately bypassed: reconnecting is the single most likely
    // moment for a queued change to finally succeed.
    window.dispatchEvent(new Event('online'));

    await vi.waitFor(() => expect(engine.status().state).toBe('idle'));
  });

  it('only subscribes once even if start is called twice', async () => {
    useEngineTimers();
    engine.start();
    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(pull).toHaveBeenCalledTimes(1);
  });
});

describe('reset', () => {
  it('clears the cursor and the outbox so the next cycle re-pulls everything', async () => {
    await setCursor(99);
    await db.beans.put(bean('bean-1'));
    await enqueueUpsert('bean', 'bean-1');

    await engine.reset();

    expect(await getCursor()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(engine.status().state).toBe('idle');
  });

  it('lets a halted engine sync again', async () => {
    pull.mockRejectedValueOnce(new SyncApiError({ status: 401, message: 'unauthorized' }));
    await engine.sync();

    await engine.reset();
    await engine.sync();

    expect(engine.status().state).toBe('idle');
  });
});
