import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RECORD_QUOTA,
  MAX_RECORDS,
  documentId,
  isPushRecord,
  planPush,
  readRecordQuota,
  wins,
  type PushRecord,
  type StoredRecord,
} from './syncBatch.js';

const EARLIER = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-02T00:00:00.000Z';

function record(overrides: Partial<PushRecord> = {}): PushRecord {
  return {
    type: 'bean',
    recordId: 'bean-1',
    updatedAt: LATER,
    deleted: false,
    schemaVersion: 1,
    payload: { roaster: 'Anchorhead' },
    ...overrides,
  };
}

function stored(updatedAt: string, deleted = false): StoredRecord {
  return { updatedAt, deleted };
}

describe('wins', () => {
  it('accepts a record the server has never seen', () => {
    expect(wins(record(), undefined)).toBe(true);
  });

  it('accepts a strictly newer record', () => {
    expect(wins(record({ updatedAt: LATER }), stored(EARLIER))).toBe(true);
  });

  it('rejects an older record', () => {
    expect(wins(record({ updatedAt: EARLIER }), stored(LATER))).toBe(false);
  });

  it('rejects an exact tie, so a re-push is a guaranteed no-op', () => {
    // This is what makes the client's retry-on-timeout safe: a push that
    // succeeded but whose response was lost cannot corrupt anything.
    expect(wins(record({ updatedAt: LATER }), stored(LATER))).toBe(false);
  });
});

describe('planPush', () => {
  it('assigns sequence numbers continuing from the cursor', () => {
    const records = [
      record({ recordId: 'a' }),
      record({ recordId: 'b' }),
      record({ recordId: 'c' }),
    ];

    const plan = planPush(records, [undefined, undefined, undefined], 41);

    expect(plan.writes.map((w) => w.seq)).toEqual([42, 43, 44]);
    expect(plan.nextSeq).toBe(44);
  });

  it('does not consume a sequence number for a rejected record', () => {
    // A gap in seq is indistinguishable from a record another device failed to
    // receive, so a stale push must leave the sequence untouched.
    const records = [
      record({ recordId: 'a', updatedAt: EARLIER }),
      record({ recordId: 'b', updatedAt: LATER }),
    ];

    const plan = planPush(records, [stored(LATER), undefined], 10);

    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({ recordId: 'b', seq: 11 });
    expect(plan.nextSeq).toBe(11);
  });

  it('reports every record in request order', () => {
    const records = [
      record({ recordId: 'a', updatedAt: EARLIER }),
      record({ recordId: 'b', updatedAt: LATER }),
    ];

    const plan = planPush(records, [stored(LATER), undefined], 0);

    expect(plan.results).toEqual([
      { id: 'bean:a', outcome: 'stale' },
      { id: 'bean:b', outcome: 'applied' },
    ]);
  });

  it('leaves the cursor alone when every record is stale', () => {
    const plan = planPush([record({ updatedAt: EARLIER })], [stored(LATER)], 7);

    expect(plan.writes).toHaveLength(0);
    expect(plan.nextSeq).toBe(7);
  });

  it('drops the payload of a tombstone', () => {
    // Keeping the body of a deleted record would defeat the deletion.
    const plan = planPush([record({ deleted: true })], [undefined], 0);

    expect(plan.writes[0]).toMatchObject({ deleted: true, payload: null });
  });

  it('keeps the tombstone clock, so the delete can still win a later comparison', () => {
    const plan = planPush([record({ deleted: true, updatedAt: LATER })], [stored(EARLIER)], 0);

    expect(plan.writes[0]?.updatedAt).toBe(LATER);
  });

  it('numbers a full 99-record chunk without gaps', () => {
    const records = Array.from({ length: MAX_RECORDS }, (_, i) =>
      record({ recordId: `bean-${i}` }),
    );

    const plan = planPush(
      records,
      records.map(() => undefined),
      0,
    );

    expect(plan.writes).toHaveLength(MAX_RECORDS);
    expect(plan.writes.map((w) => w.seq)).toEqual(
      Array.from({ length: MAX_RECORDS }, (_, i) => i + 1),
    );
    // 99 records plus the cursor write is exactly the 100-operation batch cap.
    expect(plan.writes.length + 1).toBe(100);
  });

  it('keeps types in separate documents', () => {
    const records = [
      record({ type: 'bean', recordId: 'shared' }),
      record({ type: 'photo', recordId: 'shared' }),
    ];

    const plan = planPush(records, [undefined, undefined], 0);

    expect(plan.writes.map((w) => w.id)).toEqual(['bean:shared', 'photo:shared']);
  });
});

describe('planPush record quota', () => {
  const QUOTA = 5;

  function creates(n: number): PushRecord[] {
    return Array.from({ length: n }, (_, i) => record({ recordId: `bean-${i}` }));
  }

  it('counts a new record against the quota', () => {
    const plan = planPush(creates(2), [undefined, undefined], 0, 3, QUOTA);
    expect(plan.nextRecords).toBe(5);
    expect(plan.quotaExceeded).toBeUndefined();
  });

  it('allows a chunk that lands exactly on the quota', () => {
    // An off-by-one here would make the last slot permanently unusable.
    const plan = planPush(creates(1), [undefined], 0, QUOTA - 1, QUOTA);
    expect(plan.quotaExceeded).toBeUndefined();
    expect(plan.nextRecords).toBe(QUOTA);
  });

  it('refuses a chunk that would cross the quota, and writes nothing', () => {
    const plan = planPush(creates(2), [undefined, undefined], 0, QUOTA, QUOTA);

    expect(plan.quotaExceeded).toEqual({ count: QUOTA + 2, quota: QUOTA });
    // Whole-chunk refusal. A partial apply would leave the rejected remainder
    // in neither the applied nor the stale bucket, and the client has no third
    // state to put them in.
    expect(plan.writes).toHaveLength(0);
    expect(plan.results).toHaveLength(0);
    expect(plan.nextSeq).toBe(0);
    expect(plan.nextRecords).toBe(QUOTA);
  });

  it('does not charge for editing a record the server already holds', () => {
    const plan = planPush([record({ updatedAt: LATER })], [stored(EARLIER)], 0, QUOTA, QUOTA);

    expect(plan.quotaExceeded).toBeUndefined();
    expect(plan.nextRecords).toBe(QUOTA);
  });

  it('refunds a slot when a live record is deleted', () => {
    const plan = planPush(
      [record({ deleted: true, updatedAt: LATER })],
      [stored(EARLIER)],
      0,
      QUOTA,
      QUOTA,
    );

    expect(plan.nextRecords).toBe(QUOTA - 1);
  });

  it('accepts deletes even at the quota, so a full partition can be emptied', () => {
    // The alternative is a partition that is full and has no way to stop being
    // full, which would be an unrecoverable state.
    const deletes = Array.from({ length: 3 }, (_, i) =>
      record({ recordId: `bean-${i}`, deleted: true, updatedAt: LATER }),
    );

    const plan = planPush(
      deletes,
      [stored(EARLIER), stored(EARLIER), stored(EARLIER)],
      0,
      QUOTA,
      QUOTA,
    );

    expect(plan.quotaExceeded).toBeUndefined();
    expect(plan.writes).toHaveLength(3);
    expect(plan.nextRecords).toBe(QUOTA - 3);
  });

  it('does not double-refund a record that is already a tombstone', () => {
    const plan = planPush(
      [record({ deleted: true, updatedAt: LATER })],
      [stored(EARLIER, true)],
      0,
      QUOTA,
      QUOTA,
    );

    expect(plan.nextRecords).toBe(QUOTA);
  });

  it('charges for resurrecting a tombstoned record', () => {
    const plan = planPush(
      [record({ updatedAt: LATER })],
      [stored(EARLIER, true)],
      0,
      QUOTA - 1,
      QUOTA,
    );

    expect(plan.nextRecords).toBe(QUOTA);
  });

  it('does not charge for a record rejected as stale', () => {
    const plan = planPush([record({ updatedAt: EARLIER })], [stored(LATER)], 0, QUOTA, QUOTA);

    expect(plan.quotaExceeded).toBeUndefined();
    expect(plan.nextRecords).toBe(QUOTA);
  });
});

describe('readRecordQuota', () => {
  it('falls back to the default when unset', () => {
    expect(readRecordQuota({})).toBe(DEFAULT_RECORD_QUOTA);
  });

  it('honours a configured value', () => {
    expect(readRecordQuota({ SYNC_RECORD_QUOTA: '500' })).toBe(500);
  });

  it.each([
    ['', '0'],
    ['a negative', '-1'],
    ['a fraction', '1.5'],
    ['a word', 'lots'],
  ])('ignores %s value rather than locking the user out', (_label, value) => {
    // A typo must never resolve to zero: that would refuse every write to
    // every account until someone noticed.
    expect(readRecordQuota({ SYNC_RECORD_QUOTA: value })).toBe(DEFAULT_RECORD_QUOTA);
  });
});

describe('isPushRecord', () => {
  it('accepts a well-formed record', () => {
    expect(isPushRecord(record())).toBe(true);
  });

  it.each([
    ['a null body', null],
    ['a string', 'bean'],
    ['an unknown type', record({ type: 'preferences' as never })],
    ['a blank recordId', record({ recordId: '' })],
    ['a missing clock', record({ updatedAt: '' })],
    ['a non-boolean deleted flag', { ...record(), deleted: 'yes' }],
    ['a fractional schemaVersion', record({ schemaVersion: 1.5 })],
  ])('rejects %s', (_label, value) => {
    expect(isPushRecord(value)).toBe(false);
  });

  it('accepts a null payload, which is what a tombstone carries', () => {
    expect(isPushRecord(record({ deleted: true, payload: null }))).toBe(true);
  });
});

describe('documentId', () => {
  it('namespaces the record id by type', () => {
    expect(documentId('rating', '01JABC')).toBe('rating:01JABC');
  });
});
