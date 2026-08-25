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
  return { ...actual, pull: vi.fn(), push: vi.fn(), deleteCloudData: vi.fn() };
});

vi.mock('@/services/preferences/compute', () => ({ refreshPreferences: vi.fn() }));

// Signed in by default, because that is the precondition for almost every test
// in this file. `signedInUser` is a mutable seam so the signed-out path — where
// the engine must not reach the network at all — can be exercised too.
let signedInUser: { userId: string } | null = { userId: 'user-a' };
let rememberedUser = false;

vi.mock('@/services/auth', () => ({
  getAuthProvider: () => ({ getUser: () => Promise.resolve(signedInUser) }),
  refreshAuthUser: () => Promise.resolve(signedInUser),
  hasRememberedAuthUser: () => Promise.resolve(rememberedUser),
}));

vi.mock('./photos', async () => {
  const actual = await vi.importActual<typeof syncPhotos>('./photos');
  return { ...actual, uploadPhoto: vi.fn(), backfillPhotos: vi.fn() };
});

const api = await import('./api');
const photos = await import('./photos');
const { refreshPreferences } = await import('@/services/preferences/compute');
const pull = vi.mocked(api.pull);
const push = vi.mocked(api.push);
const deleteCloudDataRequest = vi.mocked(api.deleteCloudData);
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
  signedInUser = { userId: 'user-a' };
  rememberedUser = false;
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

describe('when nobody is signed in', () => {
  beforeEach(() => {
    signedInUser = null;
  });

  it('does not call the sync API at all', async () => {
    // The engine exists for every visitor on a deployment that has auth
    // available, including one who has never signed in. Reaching the network
    // there is not just wasteful, it is a guaranteed 401.
    await engine.sync();

    expect(pull).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('stays idle instead of surfacing an error', async () => {
    await engine.sync();

    expect(engine.status().state).toBe('idle');
    expect(engine.status().lastError).toBeUndefined();
  });

  it('asks a previously signed-in user to authenticate again', async () => {
    rememberedUser = true;

    await engine.sync();

    expect(engine.status()).toMatchObject({ state: 'session-expired', pendingCount: 0 });
  });

  it('does not halt, so signing in starts syncing without a reload', async () => {
    // A 401 is terminal by design, so had the signed-out cycle been allowed to
    // reach the server the engine would have halted and stayed halted for the
    // life of the tab — the user would sign in and nothing would happen.
    await engine.sync();

    signedInUser = { userId: 'user-a' };
    await engine.sync();

    expect(pull).toHaveBeenCalled();
    expect(engine.status().state).toBe('idle');
  });

  it('skips again on the next cycle rather than caching the first answer', async () => {
    // Sign-in state changes underneath a live tab, in both directions.
    await engine.sync();
    await engine.sync();

    expect(pull).not.toHaveBeenCalled();
  });
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

  it('reports an API 401 as an expired session', async () => {
    pull.mockRejectedValue(new SyncApiError({ status: 401, message: 'unauthorized' }));

    await engine.sync();

    expect(pull).toHaveBeenCalledTimes(1);
    expect(engine.status()).toMatchObject({ state: 'session-expired' });
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

  it('syncs anyway when the user forces it, even though the browser says offline', async () => {
    // `navigator.onLine` is advisory and gets stuck at `false` on iOS after a
    // PWA resumes. That made Sync now a no-op on exactly the devices that
    // needed it: the button cleared the halt, called sync, and the cycle
    // returned at the offline check without attempting anything — leaving the
    // user pressing a button that could not work, under a message promising it
    // would sync later.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    await engine.sync({ force: true });

    expect(pull).toHaveBeenCalledTimes(1);
    expect(engine.status().state).toBe('idle');
  });

  it('lets a forced sync through the backoff window', async () => {
    // Waiting out a backoff is right for an automatic retry and wrong for a
    // person who just asked for one.
    pull.mockRejectedValueOnce(new SyncTimeoutError('/api/sync/pull'));
    await engine.sync();
    expect(engine.status().state).toBe('offline');

    await engine.sync();
    expect(pull).toHaveBeenCalledTimes(1);

    await engine.sync({ force: true });
    expect(pull).toHaveBeenCalledTimes(2);
    expect(engine.status().state).toBe('idle');
  });

  it('still skips automatic cycles while genuinely offline', async () => {
    // The flag is kept for the timer, where polling a dead radio every five
    // minutes is the battery drain the check exists to prevent.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    await engine.sync();
    await engine.sync();

    expect(pull).not.toHaveBeenCalled();
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

    await vi.waitFor(() => expect(pull).toHaveBeenCalledTimes(1));
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

describe('deleting cloud data', () => {
  beforeEach(() => {
    deleteCloudDataRequest.mockResolvedValue({ recordsDeleted: 12, photosDeleted: 3 });
  });

  it('confirms with the signed-in user id', async () => {
    // The server checks this against the principal it derived itself, so the
    // irreversible action carries a deliberate signal rather than riding on the
    // session cookie every request already has.
    await engine.deleteCloudData();

    expect(deleteCloudDataRequest).toHaveBeenCalledWith('user-a');
  });

  it('resets local sync state so the library is not re-uploaded', async () => {
    await setCursor(99);
    await db.beans.put(bean('bean-1'));
    await enqueueUpsert('bean', 'bean-1');

    await engine.deleteCloudData();

    // Without this the cursor still points past records that no longer exist,
    // and the next cycle would push everything straight back up — undoing the
    // delete the user just asked for.
    expect(await getCursor()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('leaves local records alone', async () => {
    await db.beans.put(bean('bean-1'));

    await engine.deleteCloudData();

    // This deletes the cloud copy. Conflating it with local deletion would make
    // an already-frightening button destroy more than it says.
    expect(await db.beans.count()).toBe(1);
  });

  it('reports what was removed', async () => {
    await expect(engine.deleteCloudData()).resolves.toEqual({
      recordsDeleted: 12,
      photosDeleted: 3,
    });
  });

  it('rejects rather than failing quietly', async () => {
    deleteCloudDataRequest.mockRejectedValue(new Error('cosmos unavailable'));

    // Telling someone their data is gone when it is not is the worst possible
    // outcome for this particular action.
    await expect(engine.deleteCloudData()).rejects.toThrow('cosmos unavailable');
    expect(engine.status().state).toBe('error');
  });

  it('does not re-upload after a failed delete', async () => {
    await db.beans.put(bean('bean-1'));
    await enqueueUpsert('bean', 'bean-1');
    deleteCloudDataRequest.mockRejectedValue(new Error('cosmos unavailable'));

    await expect(engine.deleteCloudData()).rejects.toThrow();
    await engine.sync();

    // The server is in an unknown state; pushing into it could restore data it
    // has partly removed.
    expect(push).not.toHaveBeenCalled();
  });

  it('clears a reported quota', async () => {
    await expect(engine.deleteCloudData()).resolves.toBeTruthy();

    expect(engine.status().photoQuota?.used).toBe(0);
  });
});
