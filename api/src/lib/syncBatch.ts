/**
 * The pure part of `/api/sync/push`: deciding what a chunk of incoming records
 * becomes, given what the server already holds.
 *
 * Split out from the handler so the rules the spec cares about — LWW rejection,
 * `seq` monotonicity, the 99-record boundary — can be tested without a Cosmos
 * instance. The handler keeps only the I/O and the retry loop.
 */

export type SyncRecordType = 'bean' | 'rating' | 'photo';

/** Transactional batches cap at 100 operations; the cursor write takes one. */
export const MAX_RECORDS = 99;

const RECORD_TYPES: ReadonlySet<string> = new Set<SyncRecordType>(['bean', 'rating', 'photo']);

export interface PushRecord {
  type: SyncRecordType;
  recordId: string;
  updatedAt: string;
  deleted: boolean;
  schemaVersion: number;
  payload: unknown;
}

export interface StoredRecord {
  updatedAt: string;
}

export interface PushOutcome {
  id: string;
  outcome: 'applied' | 'stale';
}

export interface PushPlan {
  /** Documents to upsert, already numbered. */
  writes: PlannedWrite[];
  /** Per-record result, in request order, for the response body. */
  results: PushOutcome[];
  /** The cursor value after this chunk. Unchanged when everything was stale. */
  nextSeq: number;
}

export interface PlannedWrite {
  id: string;
  type: SyncRecordType;
  recordId: string;
  seq: number;
  updatedAt: string;
  deleted: boolean;
  schemaVersion: number;
  payload: unknown;
}

export function documentId(type: SyncRecordType, recordId: string): string {
  return `${type}:${recordId}`;
}

export function isPushRecord(value: unknown): value is PushRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['type'] === 'string' &&
    RECORD_TYPES.has(v['type']) &&
    typeof v['recordId'] === 'string' &&
    v['recordId'] !== '' &&
    typeof v['updatedAt'] === 'string' &&
    v['updatedAt'] !== '' &&
    typeof v['deleted'] === 'boolean' &&
    typeof v['schemaVersion'] === 'number' &&
    Number.isInteger(v['schemaVersion'])
  );
}

/**
 * True when `incoming` should replace `existing`.
 *
 * Deliberately identical to `src/services/sync/merge.ts` on the client: the two
 * sides must agree or a record could be accepted by one and rejected by the
 * other, and the pair would never converge. Strictly greater, so re-pushing an
 * unchanged record is a guaranteed no-op — which is what makes the client's
 * retry-on-timeout safe.
 *
 * Timestamps are compared lexicographically. `data-model.md` mandates
 * `new Date().toISOString()`, which is fixed-width UTC, so string order is
 * chronological order without parsing.
 */
export function wins(incoming: PushRecord, existing: StoredRecord | undefined): boolean {
  if (!existing) return true;
  return incoming.updatedAt > existing.updatedAt;
}

/**
 * Numbers the accepted records and reports the rest as stale.
 *
 * `existing[i]` is what the server holds for `records[i]`, or undefined. Seq is
 * assigned only to accepted records: a rejected push must not consume a
 * sequence number, or every other device would see a gap and could not tell it
 * from a record it failed to receive.
 */
export function planPush(
  records: readonly PushRecord[],
  existing: readonly (StoredRecord | undefined)[],
  cursorSeq: number,
): PushPlan {
  const writes: PlannedWrite[] = [];
  const results: PushOutcome[] = [];
  let seq = cursorSeq;

  records.forEach((record, index) => {
    const id = documentId(record.type, record.recordId);
    if (!wins(record, existing[index])) {
      // The server holds a newer version. The client drops its outbox entry and
      // picks up the winner on the next pull, so there is nothing to write.
      results.push({ id, outcome: 'stale' });
      return;
    }

    writes.push({
      id,
      type: record.type,
      recordId: record.recordId,
      seq: ++seq,
      updatedAt: record.updatedAt,
      deleted: record.deleted,
      schemaVersion: record.schemaVersion,
      // A tombstone keeps its identity and clock but drops the body; retaining
      // the payload of a deleted record would defeat the deletion.
      payload: record.deleted ? null : record.payload,
    });
    results.push({ id, outcome: 'applied' });
  });

  return { writes, results, nextSeq: seq };
}
