import Dexie, { type Table } from 'dexie';
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

  constructor() {
    super('coffee-app');
    this.version(1).stores({
      beans: 'id, roaster, createdAt, isArchived, needsReview, *tastingNotes',
      ratings: 'id, beanId, ratedAt, brewType',
      photos: 'id, kind',
      ocrResults: 'id, photoId',
      preferences: 'id',
      pendingAiTasks: 'id, type, nextAttemptAt',
      meta: 'key',
    });
  }
}

export const db = new CoffeeDB();
