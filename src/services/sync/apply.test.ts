import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean, Rating } from '@/types';

import { NeedsUpgradeError, applyPulled } from './apply';
import type { SyncDocument } from './api';
import { enqueueUpsert } from './outbox';

const EARLIER = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-02T00:00:00.000Z';

function bean(id: string, updatedAt: string): CoffeeBean {
  return {
    id,
    schemaVersion: 1,
    roaster: 'Anchorhead',
    name: `Bean ${id}`,
    isArchived: false,
    needsReview: false,
    createdAt: EARLIER,
    updatedAt,
  } as CoffeeBean;
}

function rating(id: string, beanId: string, updatedAt: string, score = 8): Rating {
  return {
    id,
    schemaVersion: 2,
    beanId,
    score,
    brewType: 'espresso',
    ratedAt: EARLIER,
    createdAt: EARLIER,
    updatedAt,
  };
}

function doc(overrides: Partial<SyncDocument> = {}): SyncDocument {
  const type = overrides.type ?? 'bean';
  const recordId = overrides.recordId ?? 'bean-1';
  return {
    id: `${type}:${recordId}`,
    userId: 'user-a',
    type,
    recordId,
    seq: 1,
    updatedAt: LATER,
    deleted: false,
    schemaVersion: type === 'rating' ? 2 : 1,
    deviceId: 'device-b',
    payload: type === 'rating' ? rating(recordId, 'bean-1', LATER) : bean(recordId, LATER),
    ...overrides,
  };
}

beforeEach(async () => {
  await Promise.all([
    db.beans.clear(),
    db.ratings.clear(),
    db.photos.clear(),
    db.ocrResults.clear(),
    db.outbox.clear(),
  ]);
});

describe('applyPulled', () => {
  it('writes a record this device has never seen', async () => {
    const result = await applyPulled([doc()]);

    expect(result).toMatchObject({ applied: 1, skipped: 0 });
    expect(await db.beans.get('bean-1')).toMatchObject({ roaster: 'Anchorhead' });
  });

  it('overwrites an older local record', async () => {
    await db.beans.put(bean('bean-1', EARLIER));

    await applyPulled([doc({ payload: { ...bean('bean-1', LATER), roaster: 'Remote' } })]);

    expect((await db.beans.get('bean-1'))?.roaster).toBe('Remote');
  });

  it('keeps a newer local record', async () => {
    await db.beans.put({ ...bean('bean-1', LATER), roaster: 'Local' });

    const result = await applyPulled([
      doc({ updatedAt: EARLIER, payload: { ...bean('bean-1', EARLIER), roaster: 'Remote' } }),
    ]);

    expect(result).toMatchObject({ applied: 0, skipped: 1 });
    expect((await db.beans.get('bean-1'))?.roaster).toBe('Local');
  });

  it('keeps the local record on an exact tie', async () => {
    await db.beans.put({ ...bean('bean-1', LATER), roaster: 'Local' });

    await applyPulled([
      doc({ updatedAt: LATER, payload: { ...bean('bean-1', LATER), roaster: 'Remote' } }),
    ]);

    expect((await db.beans.get('bean-1'))?.roaster).toBe('Local');
  });

  it('applies a tombstone', async () => {
    await db.beans.put(bean('bean-1', EARLIER));

    await applyPulled([doc({ deleted: true, updatedAt: LATER, payload: null })]);

    expect(await db.beans.get('bean-1')).toBeUndefined();
  });

  it('lets a newer local edit survive an older remote delete', async () => {
    await db.beans.put(bean('bean-1', LATER));

    await applyPulled([doc({ deleted: true, updatedAt: EARLIER, payload: null })]);

    expect(await db.beans.get('bean-1')).toBeDefined();
  });

  it('writes under the envelope id, not one supplied in the payload', async () => {
    // A malformed or hostile document must not be able to write over a
    // different record than the one it claims to be.
    await applyPulled([
      doc({ recordId: 'bean-1', payload: { ...bean('bean-1', LATER), id: 'bean-evil' } }),
    ]);

    expect(await db.beans.get('bean-1')).toBeDefined();
    expect(await db.beans.get('bean-evil')).toBeUndefined();
  });

  it('drops a pending outbox entry when the remote version wins', async () => {
    // The queued entry describes the version that just lost the merge. Pushing
    // it later would resurrect the loser and undo the resolution.
    await db.beans.put(bean('bean-1', EARLIER));
    await enqueueUpsert('bean', 'bean-1');
    expect(await db.outbox.count()).toBe(1);

    await applyPulled([doc({ updatedAt: LATER })]);

    expect(await db.outbox.count()).toBe(0);
  });

  it('leaves the outbox alone when the local record wins', async () => {
    await db.beans.put(bean('bean-1', LATER));
    await enqueueUpsert('bean', 'bean-1');

    await applyPulled([doc({ updatedAt: EARLIER })]);

    expect(await db.outbox.count()).toBe(1);
  });

  it('reports that preferences need recomputing when a rating changes', async () => {
    const result = await applyPulled([doc({ type: 'rating', recordId: 'rating-1' })]);

    expect(result.touchedPreferenceInputs).toBe(true);
  });

  it('does not recompute preferences for a photo-only batch', async () => {
    // Preferences derive from beans and ratings; photos cannot change them.
    const result = await applyPulled([
      doc({
        type: 'photo',
        recordId: 'photo-1',
        payload: { id: 'photo-1', schemaVersion: 1, kind: 'bag', createdAt: EARLIER },
      }),
    ]);

    expect(result.touchedPreferenceInputs).toBe(false);
  });

  it('never clobbers photo bytes this device already holds', async () => {
    // Photo blobs are immutable, so a local copy is always as good as the
    // remote one — and the pulled document carries no bytes at all.
    await db.photos.put({
      id: 'photo-1',
      schemaVersion: 1,
      kind: 'bag',
      blob: new Blob(['real-bytes']),
      createdAt: EARLIER,
    } as never);
    const put = vi.spyOn(db.photos, 'put');

    await applyPulled([
      doc({
        type: 'photo',
        recordId: 'photo-1',
        updatedAt: LATER,
        payload: { id: 'photo-1', schemaVersion: 1, kind: 'bag', createdAt: LATER },
      }),
    ]);

    // Asserted on the value handed to the write rather than on what comes back
    // out: fake-indexeddb does not round-trip Blob, so a stored blob returns as
    // an opaque object with no readable size. The placeholder, by contrast, is
    // a real zero-length Blob — so "not an empty Blob" proves the local bytes
    // were carried through, and stays true if fake-indexeddb ever gains real
    // Blob support.
    const written = put.mock.calls[0]?.[0] as { blob: Blob };
    expect(written.blob instanceof Blob && written.blob.size === 0).toBe(false);
    put.mockRestore();
  });

  it('removes device-local OCR results when a photo is deleted remotely', async () => {
    await db.photos.put({
      id: 'photo-1',
      schemaVersion: 1,
      kind: 'bag',
      blob: new Blob(['x']),
      createdAt: EARLIER,
    } as never);
    await db.ocrResults.put({ id: 'ocr-1', photoId: 'photo-1' } as never);

    await applyPulled([
      doc({ type: 'photo', recordId: 'photo-1', deleted: true, updatedAt: LATER, payload: null }),
    ]);

    expect(await db.ocrResults.count()).toBe(0);
  });

  it('halts on a record from a newer build', async () => {
    await expect(applyPulled([doc({ schemaVersion: 99 })])).rejects.toBeInstanceOf(
      NeedsUpgradeError,
    );
  });

  it('writes nothing at all when any record in the batch is unreadable', async () => {
    // A partial apply followed by a halt would leave the cursor ambiguous:
    // some of the batch landed, some did not, and nothing records which.
    await expect(
      applyPulled([doc({ recordId: 'bean-ok' }), doc({ recordId: 'bean-bad', schemaVersion: 99 })]),
    ).rejects.toBeInstanceOf(NeedsUpgradeError);

    expect(await db.beans.count()).toBe(0);
  });

  it('is a no-op for an empty batch', async () => {
    expect(await applyPulled([])).toEqual({
      applied: 0,
      skipped: 0,
      touchedPreferenceInputs: false,
    });
  });

  it('logs a rejected write so a lost edit can be explained later', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await db.beans.put(bean('bean-1', LATER));

    await applyPulled([doc({ updatedAt: EARLIER })]);

    expect(info).toHaveBeenCalledWith(
      'sync: kept local record',
      expect.objectContaining({
        id: 'bean:bean-1',
        fromDevice: 'device-b',
      }),
    );
    info.mockRestore();
  });
});
