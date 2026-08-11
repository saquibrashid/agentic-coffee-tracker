/**
 * An in-process stand-in for `/api/sync/*`, shared by two browser contexts.
 *
 * The point of the two-device test is to prove the *client* converges: that
 * `CloudSyncEngine`, the outbox, the transport and `merge.ts` together take two
 * independent devices to the same state. It is not a test of Cosmos.
 *
 * So the server is faked, but its two load-bearing rules — server-assigned
 * monotonic `seq`, and strictly-greater last-write-wins — are implemented here
 * exactly as `api/src/lib/syncBatch.ts` implements them, because a fake that
 * got either wrong would let a broken client pass. Those rules are separately
 * unit-tested against the real implementation in `api/src/lib/syncBatch.test.ts`;
 * what this file adds is the half no unit test can reach, which is two devices
 * with two IndexedDBs actually agreeing.
 */

export interface SyncDocument {
  id: string;
  userId: string;
  type: 'bean' | 'rating' | 'photo';
  recordId: string;
  seq: number;
  updatedAt: string;
  deleted: boolean;
  schemaVersion: number;
  deviceId: string;
  payload: unknown;
}

interface PushRecord {
  type: 'bean' | 'rating' | 'photo';
  recordId: string;
  updatedAt: string;
  deleted: boolean;
  schemaVersion: number;
  payload: unknown;
}

export class FakeSyncService {
  #docs = new Map<string, SyncDocument>();
  #seq = 0;

  /** Requests seen, per path. Lets a test assert that nothing was sent. */
  readonly calls: string[] = [];

  pull(cursor: number, limit = 200): { records: SyncDocument[]; cursor: number; hasMore: boolean } {
    const records = [...this.#docs.values()]
      .filter((doc) => doc.seq > cursor)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);

    return {
      records,
      // Never a seq the client has not actually received, or the gap is
      // permanent.
      cursor: records.length > 0 ? records[records.length - 1]!.seq : cursor,
      hasMore: records.length === limit,
    };
  }

  push(
    deviceId: string,
    records: PushRecord[],
  ): { cursor: number; results: { id: string; outcome: 'applied' | 'stale' }[] } {
    const results: { id: string; outcome: 'applied' | 'stale' }[] = [];

    for (const record of records) {
      const id = `${record.type}:${record.recordId}`;
      const existing = this.#docs.get(id);

      // Strictly greater, so re-pushing an unchanged record is a no-op — which
      // is what makes the client's retry-on-timeout safe.
      if (existing && record.updatedAt <= existing.updatedAt) {
        results.push({ id, outcome: 'stale' });
        continue;
      }

      this.#docs.set(id, {
        id,
        userId: 'user-a',
        type: record.type,
        recordId: record.recordId,
        // Seq is assigned only to accepted records. A rejected push must not
        // consume one, or every other device sees a gap.
        seq: ++this.#seq,
        updatedAt: record.updatedAt,
        deleted: record.deleted,
        schemaVersion: record.schemaVersion,
        deviceId,
        payload: record.deleted ? null : record.payload,
      });
      results.push({ id, outcome: 'applied' });
    }

    return { cursor: this.#seq, results };
  }

  get(type: string, recordId: string): SyncDocument | undefined {
    return this.#docs.get(`${type}:${recordId}`);
  }

  get size(): number {
    return [...this.#docs.values()].filter((doc) => !doc.deleted).length;
  }
}
