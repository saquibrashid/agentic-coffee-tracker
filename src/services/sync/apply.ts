/**
 * Applies a pulled batch of records to the local database.
 *
 * Kept separate from the engine so the merge rules can be tested without a
 * network or a Web Lock. `specs/sync.md` -> Conflict policy.
 */
import { db } from '@/services/db';
import type { CoffeeBean, PhotoBlob, Rating } from '@/types';
import type { SyncDocument } from './api';
import { clockOf, resolve } from './merge';

export interface ApplyResult {
  applied: number;
  /** Rejected because the local copy was newer or equal. */
  skipped: number;
  /** True when any bean or rating changed, so preferences need recomputing. */
  touchedPreferenceInputs: boolean;
}

/**
 * Thrown when the server holds a record written by a newer build.
 *
 * The cycle must halt rather than continue: applying it would silently
 * downgrade fields this build cannot represent, and skipping it would advance
 * the cursor past a record we never applied, losing it permanently.
 */
export class NeedsUpgradeError extends Error {
  constructor(
    readonly incomingVersion: number,
    readonly supportedVersion: number,
  ) {
    super(
      `The server holds records in schema v${incomingVersion}; this build understands v${supportedVersion}.`,
    );
    this.name = 'NeedsUpgradeError';
  }
}

/**
 * Photo bytes are not in the record stream — only metadata is. A pulled photo
 * document therefore describes a blob this device may not hold yet, and the
 * placeholder keeps the record consistent until Phase 6 backfills the bytes.
 */
const EMPTY_BLOB_PLACEHOLDER = new Blob([], { type: 'application/octet-stream' });

/**
 * Applies one pulled batch.
 *
 * Runs in a single transaction covering the record tables *and* the outbox. A
 * remote record that wins must clear any pending local entry for the same
 * record: that entry describes a version the server has already superseded, and
 * pushing it later would resurrect the loser of a conflict the merge just
 * settled.
 */
export async function applyPulled(records: readonly SyncDocument[]): Promise<ApplyResult> {
  if (records.length === 0) {
    return { applied: 0, skipped: 0, touchedPreferenceInputs: false };
  }

  // The guard runs over the whole batch before anything is written. A partial
  // apply followed by a halt would leave the cursor ambiguous — some of this
  // batch landed, some did not, and nothing records which.
  for (const record of records) {
    const decision = resolve(
      record.type,
      { updatedAt: record.updatedAt, schemaVersion: record.schemaVersion },
      null,
    );
    if (decision.outcome === 'needs-upgrade') {
      throw new NeedsUpgradeError(decision.incomingVersion, decision.supportedVersion);
    }
  }

  return db.transaction(
    'rw',
    [db.beans, db.ratings, db.photos, db.ocrResults, db.outbox],
    async () => {
      let applied = 0;
      let skipped = 0;
      let touchedPreferenceInputs = false;

      for (const record of records) {
        const existing = await readExisting(record);
        const decision = resolve(
          record.type,
          { updatedAt: record.updatedAt, schemaVersion: record.schemaVersion },
          existing ? { updatedAt: clockOf(existing), schemaVersion: existing.schemaVersion } : null,
        );

        if (decision.outcome !== 'apply') {
          // Observable on purpose: "my edit disappeared" is unanswerable
          // without a record of which write lost and to what.
          console.info('sync: kept local record', {
            id: record.id,
            incoming: record.updatedAt,
            local: existing ? clockOf(existing) : null,
            fromDevice: record.deviceId,
          });
          skipped += 1;
          continue;
        }

        await write(record);
        applied += 1;
        if (record.type !== 'photo') touchedPreferenceInputs = true;

        // The server's version won, so any queued local change for this record
        // is the version that just lost. Dropping it prevents the next push
        // from undoing the merge.
        const pending = await db.outbox
          .where('[type+recordId]')
          .equals([record.type, record.recordId])
          .primaryKeys();
        if (pending.length > 0) await db.outbox.bulkDelete(pending);
      }

      return { applied, skipped, touchedPreferenceInputs };
    },
  );
}

type StoredRecord = (CoffeeBean | Rating | PhotoBlob) & { schemaVersion: number };

async function readExisting(record: SyncDocument): Promise<StoredRecord | undefined> {
  switch (record.type) {
    case 'bean':
      return db.beans.get(record.recordId);
    case 'rating':
      return db.ratings.get(record.recordId);
    case 'photo':
      return db.photos.get(record.recordId);
  }
}

async function write(record: SyncDocument): Promise<void> {
  if (record.deleted) {
    await remove(record);
    return;
  }
  // The payload is the record as it was written on another device, minus blob
  // bytes. `id` is restored from the envelope rather than trusted from the
  // payload, so a malformed document cannot write under a different key.
  const payload = { ...(record.payload as object), id: record.recordId };

  switch (record.type) {
    case 'bean':
      await db.beans.put(payload as CoffeeBean);
      return;
    case 'rating':
      await db.ratings.put(payload as Rating);
      return;
    case 'photo': {
      // Never clobber bytes we already hold with the placeholder: photo blobs
      // are immutable, so a local copy is always as good as the remote one.
      const existing = await db.photos.get(record.recordId);
      const blob = existing?.blob ?? EMPTY_BLOB_PLACEHOLDER;
      await db.photos.put({ ...(payload as PhotoBlob), blob });
      return;
    }
  }
}

async function remove(record: SyncDocument): Promise<void> {
  switch (record.type) {
    case 'bean':
      await db.beans.delete(record.recordId);
      return;
    case 'rating':
      await db.ratings.delete(record.recordId);
      return;
    case 'photo': {
      // OCR results hang off the photo and are device-local, so they are not in
      // the record stream and would otherwise be orphaned by a remote delete.
      const ocrIds = await db.ocrResults.where('photoId').equals(record.recordId).primaryKeys();
      await db.ocrResults.bulkDelete(ocrIds);
      await db.photos.delete(record.recordId);
      return;
    }
  }
}
