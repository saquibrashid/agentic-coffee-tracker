import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';

import {
  clear,
  enqueueDelete,
  enqueueManyUpserts,
  enqueueUpsert,
  pendingCount,
  recordFailure,
  removeEntries,
  takeBatch,
} from './outbox';

beforeEach(async () => {
  await db.outbox.clear();
});

describe('enqueue', () => {
  it('records an upsert', async () => {
    await enqueueUpsert('bean', 'bean-1');

    const [entry] = await takeBatch();
    expect(entry).toMatchObject({
      type: 'bean',
      recordId: 'bean-1',
      op: 'upsert',
      attempts: 0,
    });
  });

  it('coalesces repeated edits of one record into a single entry', async () => {
    await enqueueUpsert('bean', 'bean-1');
    await enqueueUpsert('bean', 'bean-1');
    await enqueueUpsert('bean', 'bean-1');

    expect(await pendingCount()).toBe(1);
  });

  it('keeps entries for the same id under different types apart', async () => {
    // Ids are ULIDs so a collision is not expected, but the index is compound
    // for a reason and a bean must never be collapsed into a photo.
    await enqueueUpsert('bean', 'shared-id');
    await enqueueUpsert('photo', 'shared-id');

    expect(await pendingCount()).toBe(2);
  });

  it('lets a delete supersede a pending upsert', async () => {
    await enqueueUpsert('rating', 'rating-1');
    await enqueueDelete('rating', 'rating-1', '2026-01-02T00:00:00.000Z');

    const entries = await takeBatch();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ op: 'delete', deletedAt: '2026-01-02T00:00:00.000Z' });
  });

  it('lets an upsert supersede a pending delete, for a recreated record', async () => {
    await enqueueDelete('rating', 'rating-1');
    await enqueueUpsert('rating', 'rating-1');

    const entries = await takeBatch();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.op).toBe('upsert');
    // The stale tombstone clock must not ride along, or the server would see a
    // delete time on a live record.
    expect(entries[0]?.deletedAt).toBeUndefined();
  });

  it('resets backoff when a record changes again', async () => {
    await enqueueUpsert('bean', 'bean-1');
    const [first] = await takeBatch();
    await recordFailure([first!.id], 'boom');

    await enqueueUpsert('bean', 'bean-1');

    const [entry] = await takeBatch();
    expect(entry?.attempts).toBe(0);
    expect(entry).not.toHaveProperty('lastError');
  });

  it('never throws into the caller when the write fails', async () => {
    // Recording a change for sync must not cost the user their edit.
    db.close();
    await expect(enqueueUpsert('bean', 'bean-1')).resolves.toBeUndefined();
    await db.open();
  });

  it('enqueues in bulk', async () => {
    await enqueueManyUpserts('bean', ['a', 'b', 'c']);
    expect(await pendingCount()).toBe(3);
  });
});

describe('draining', () => {
  it('returns oldest first', async () => {
    await enqueueUpsert('bean', 'first');
    await new Promise((r) => setTimeout(r, 2));
    await enqueueUpsert('bean', 'second');

    const entries = await takeBatch();
    expect(entries.map((e) => e.recordId)).toEqual(['first', 'second']);
  });

  it('caps the batch, so a push stays under the transactional-batch limit', async () => {
    await enqueueManyUpserts(
      'bean',
      Array.from({ length: 10 }, (_, i) => `bean-${i}`),
    );

    expect(await takeBatch(4)).toHaveLength(4);
  });

  it('removes acknowledged entries and leaves the rest', async () => {
    await enqueueManyUpserts('bean', ['a', 'b', 'c']);
    const entries = await takeBatch();

    await removeEntries([entries[0]!.id, entries[1]!.id]);

    const remaining = await takeBatch();
    expect(remaining.map((e) => e.recordId)).toEqual(['c']);
  });

  it('tolerates an empty acknowledgement', async () => {
    await enqueueUpsert('bean', 'a');
    await removeEntries([]);
    expect(await pendingCount()).toBe(1);
  });
});

describe('recordFailure', () => {
  it('increments attempts and stores the reason', async () => {
    await enqueueUpsert('bean', 'a');
    const [entry] = await takeBatch();

    await recordFailure([entry!.id], 'HTTP 503');
    await recordFailure([entry!.id], 'HTTP 503');

    const [updated] = await takeBatch();
    expect(updated).toMatchObject({ attempts: 2, lastError: 'HTTP 503' });
  });

  it('ignores entries that were already acknowledged', async () => {
    await expect(recordFailure(['gone'], 'boom')).resolves.toBeUndefined();
  });
});

describe('clear', () => {
  it('empties the queue for reset()', async () => {
    await enqueueManyUpserts('bean', ['a', 'b']);
    await clear();
    expect(await pendingCount()).toBe(0);
  });
});
