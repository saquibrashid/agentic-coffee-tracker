import Dexie, { type Table } from 'dexie';
import { rescaleLegacyScore } from '@/services/ratings/scale';
import type {
  CoffeeBean,
  Rating,
  PhotoBlob,
  OcrResult,
  UserPreferences,
  PendingAiTask,
} from '@/types';

interface MetaRecord {
  key: string;
  value: unknown;
}

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
  }
}

export const db = new CoffeeDB();
