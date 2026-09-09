import Dexie, { type Table } from 'dexie';
import { rescaleLegacyScore } from '@/services/ratings/scale';
import type {
  CoffeeBean,
  CoffeeFormat,
  Rating,
  PhotoBlob,
  OcrResult,
  UserPreferences,
  PendingAiTask,
  OutboxEntry,
} from '@/types';

interface MetaRecord {
  key: string;
  value: unknown;
}

/**
 * Values the retired `vendor` field could hold that name a format we now model.
 *
 * Keyed case-folded. Anything absent from this table was a shop rather than a
 * format and is discarded by the v6 upgrade.
 */
const LEGACY_VENDOR_FORMATS: Record<string, CoffeeFormat> = {
  cometeer: 'cometeer',
  nespresso: 'nespresso',
  'k-cup': 'k-cup',
  keurig: 'k-cup',
};

/**
 * Single Dexie database for the app. See specs/data-model.md for the store layout
 * and specs/architecture.md for the migration policy.
 */
export class CoffeeDB extends Dexie {
  beans!: Table<CoffeeBean, string>;
  ratings!: Table<Rating, string>;
  photos!: Table<PhotoBlob, string>;
  ocrResults!: Table<OcrResult, string>;
  preferences!: Table<UserPreferences, string>;
  pendingAiTasks!: Table<PendingAiTask, string>;
  meta!: Table<MetaRecord, string>;
  outbox!: Table<OutboxEntry, string>;

  // The name is injectable purely so migration tests can open an isolated
  // database; the app always uses the default.
  constructor(name = 'coffee-app') {
    super(name);
    this.version(1).stores({
      beans: 'id, roaster, createdAt, isArchived, needsReview, *tastingNotes',
      ratings: 'id, beanId, ratedAt, brewType',
      photos: 'id, kind',
      ocrResults: 'id, photoId',
      preferences: 'id',
      pendingAiTasks: 'id, type, nextAttemptAt',
      meta: 'key',
    });

    // v2 widened the rating scale from 1–5 to 1–10 (specs/data-model.md).
    // Stored scores were written under the old scale, so they are converted
    // once, here, rather than being reinterpreted at every read site: a 4 left
    // untouched would silently mean "mediocre" instead of "good". The schema
    // itself is unchanged, so no `.stores()` call is needed — Dexie inherits it.
    this.version(2).upgrade(async (tx) => {
      await tx
        .table<Rating>('ratings')
        .toCollection()
        .modify((rating) => {
          // Defensive: a record already at v2 must never be doubled twice.
          if (rating.schemaVersion >= 2) return;
          rating.score = rescaleLegacyScore(rating.score);
          rating.schemaVersion = 2;
        });
      // The cached preference profile is derived from those scores, so it is
      // stale the moment they change. Dropping it forces a clean recompute.
      await tx.table('preferences').clear();
    });

    // v3 adds the sync outbox (specs/sync.md -> Dexie v3 migration). Purely
    // additive: no existing store changes, so no upgrade() body is needed.
    //
    // The compound [type+recordId] index is what lets enqueue coalesce — if an
    // entry for that pair is already pending it is updated in place rather than
    // appended, so a record edited ten times still pushes once.
    this.version(3).stores({
      outbox: 'id, [type+recordId], queuedAt',
    });

    // v4 indexes pendingAiTasks.beanId. The confirm form looks tasks up by the
    // coffee they belong to — to drop them when a draft is discarded, and to
    // avoid stacking a second web lookup on a coffee that already has one
    // queued. Dexie rejects `where()` on an unindexed keypath outright, so
    // discarding a draft was throwing a SchemaError after the coffee had
    // already been deleted, leaving the user on a dead form.
    this.version(4).stores({
      pendingAiTasks: 'id, type, nextAttemptAt, beanId',
    });

    // v5 indexes photos.sourcePhotoId, which a studio shot carries to point at
    // the photo it was generated from (specs/data-model.md). The index is what
    // lets the reverse question be asked cheaply — "does this original already
    // have a studio shot?" — which the bulk re-shoot needs once per coffee to
    // avoid paying for the same image twice. Purely additive: existing photos
    // have no such field and are simply absent from the index.
    this.version(5).stores({
      photos: 'id, kind, sourcePhotoId',
    });

    // v6 retires `vendor`, which shipped briefly on the wrong idea that a
    // Cometeer box is coffee *sold by* Cometeer. It is not: Cometeer
    // flash-freezes other roasters' brewed coffee into pucks, so the box is
    // still the roaster's coffee in a different form, and the shop it was
    // actually carried out of says nothing about the coffee.
    //
    // Any value that names a format we now model is moved onto `format`;
    // anything else was a shop name and is dropped, which is the point of the
    // change. The field is deleted either way so it stops syncing between
    // devices. No `.stores()` call is needed: `vendor` was never indexed.
    this.version(6).upgrade(async (tx) => {
      await tx
        .table<CoffeeBean & { vendor?: string }>('beans')
        .toCollection()
        .modify((bean) => {
          const vendor = bean.vendor?.trim().toLowerCase();
          if (!vendor) return;
          delete bean.vendor;
          if (bean.format) return;
          const known = LEGACY_VENDOR_FORMATS[vendor];
          if (known) bean.format = known;
        });
    });
  }
}

export const db = new CoffeeDB();
