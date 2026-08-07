import { db } from '@/services/db';
import { dataUrlToBlob } from '@/services/image/imagePipeline';
import { rescaleLegacyScore } from '@/services/ratings/scale';
import type { CoffeeBean, PhotoBlob, Rating } from '@/types';
import { ImportFormatError } from './ratingsImport';

/**
 * Restores a backup produced by the Export buttons on this page.
 *
 * This is the round-trip path — moving a library to a new device, or recovering
 * after "Delete all data". It merges rather than replaces: records whose id is
 * already present are left alone, so restoring a backup over a library that has
 * moved on cannot destroy the newer entries.
 */

export interface JsonImportPlan {
  newBeans: CoffeeBean[];
  newRatings: Rating[];
  newPhotos: PhotoBlob[];
  /** Records skipped because their id is already stored. */
  skippedBeans: number;
  skippedRatings: number;
  skippedPhotos: number;
  /** Ratings dropped because the coffee they belong to is nowhere to be found. */
  orphanedRatings: number;
}

interface ExportedPhoto extends Omit<PhotoBlob, 'blob'> {
  dataUrl?: string;
  blob?: Blob;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Pulls an array off the payload, tolerating the key being absent entirely. */
function readArray<T>(payload: Record<string, unknown>, key: string): T[] {
  const value = payload[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ImportFormatError(`"${key}" should be a list.`);
  return value as T[];
}

export async function planJsonImport(text: string): Promise<JsonImportPlan> {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ImportFormatError('That file is not valid JSON.');
  }
  if (!isRecord(payload)) throw new ImportFormatError('That file is not a coffee export.');

  const beans = readArray<CoffeeBean>(payload, 'beans');
  const ratings = readArray<Rating>(payload, 'ratings');
  const photos = readArray<ExportedPhoto>(payload, 'photos');

  if (beans.length === 0 && ratings.length === 0) {
    throw new ImportFormatError('That export contains no coffees or ratings.');
  }

  const [existingBeans, existingRatings, existingPhotos] = await Promise.all([
    db.beans.toArray(),
    db.ratings.toArray(),
    db.photos.toArray(),
  ]);

  const beanIds = new Set(existingBeans.map((b) => b.id));
  const ratingIds = new Set(existingRatings.map((r) => r.id));
  const photoIds = new Set(existingPhotos.map((p) => p.id));

  const newBeans = beans.filter(
    (b) => isRecord(b) && typeof b.id === 'string' && !beanIds.has(b.id),
  );
  for (const bean of newBeans) beanIds.add(bean.id);

  const candidateRatings = ratings.filter(
    (r) => isRecord(r) && typeof r.id === 'string' && !ratingIds.has(r.id),
  );
  // A rating whose bean is missing would be invisible in the UI but would still
  // skew the preference profile, so it is dropped rather than half-restored.
  // A backup taken before the 1–10 change carries 1–5 scores, so it is migrated
  // on the way in exactly as the Dexie v2 upgrade migrates live data.
  const newRatings = candidateRatings
    .filter((r) => beanIds.has(r.beanId))
    .map((r) =>
      r.schemaVersion >= 2
        ? r
        : ({ ...r, score: rescaleLegacyScore(r.score), schemaVersion: 2 } satisfies Rating),
    );

  const newPhotos: PhotoBlob[] = [];
  let skippedPhotos = 0;
  for (const photo of photos) {
    if (!isRecord(photo) || typeof photo.id !== 'string' || photoIds.has(photo.id)) {
      skippedPhotos += 1;
      continue;
    }
    const { dataUrl, blob, ...rest } = photo;
    // Exports embed photos as base64; a File-backed blob does not survive JSON.
    const restored = blob instanceof Blob ? blob : dataUrl ? dataUrlToBlob(dataUrl) : null;
    if (!restored) {
      skippedPhotos += 1;
      continue;
    }
    newPhotos.push({ ...(rest as Omit<PhotoBlob, 'blob'>), blob: restored });
    photoIds.add(photo.id);
  }

  return {
    newBeans,
    newRatings,
    newPhotos,
    skippedBeans: beans.length - newBeans.length,
    skippedRatings: ratings.length - newRatings.length,
    skippedPhotos,
    orphanedRatings: candidateRatings.length - newRatings.length,
  };
}

export async function applyJsonImportPlan(plan: JsonImportPlan): Promise<void> {
  const { newBeans, newRatings, newPhotos } = plan;
  if (newBeans.length === 0 && newRatings.length === 0 && newPhotos.length === 0) return;
  await db.transaction('rw', [db.beans, db.ratings, db.photos], async () => {
    if (newBeans.length > 0) await db.beans.bulkPut(newBeans);
    if (newRatings.length > 0) await db.ratings.bulkPut(newRatings);
    if (newPhotos.length > 0) await db.photos.bulkPut(newPhotos);
  });
}
