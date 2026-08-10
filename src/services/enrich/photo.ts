/**
 * Turns a product image found during web enrichment into a stored bean photo.
 *
 * The image goes through exactly the same resize/thumbnail pipeline as a
 * camera capture, so a bag shot pulled off a roaster's site is indistinguishable
 * downstream from one the user took: same WebP encoding, same size ceiling, same
 * `PhotoBlob` record, same thumbnail on the library card.
 *
 * Two rules make this safe to run unattended during a bulk import:
 *
 *  1. A photo the user supplied is only ever replaced by an explicit choice.
 *     Unattended enrichment fills gaps and nothing more.
 *  2. Failure is never fatal. A missing image is a cosmetic loss, so it must not
 *     take down the metadata enrichment happening alongside it.
 *
 * Fetching is split from storing — `preparePhotoFromUrl` then
 * `commitStagedPhoto` — because the interactive flow has to know how big the
 * found image actually is before it can ask whether to keep it, and the only
 * honest way to know that is to run it through the pipeline first.
 */
import { ulid } from 'ulid';
import { fetchImage } from '@/services/ai';
import { db } from '@/services/db';
import { createThumbnail, dataUrlToBlob, resizeDataUrl } from '@/services/image/imagePipeline';
import { enqueueDelete, enqueueUpsert } from '@/services/sync/outbox';
import type { CoffeeBean, PhotoBlob } from '@/types';

/** The fields an attached photo contributes to the bean record. */
export interface PhotoUpdate {
  photoId: string;
  thumbnailDataUrl: string;
}

/** A fetched, resized image held in memory, not yet written to the database. */
export interface StagedPhoto {
  blob: Blob;
  thumbnailDataUrl: string;
  widthPx: number;
  heightPx: number;
}

/** Pixel dimensions of something already stored. */
export type PhotoDimensions = Pick<PhotoBlob, 'widthPx' | 'heightPx'>;

/**
 * How much larger a found image must be before it is worth offering as a
 * replacement, measured in pixel area.
 *
 * Both images have already been through the same 1600px cap by the time they
 * are compared, so this is a fair fight rather than a comparison of source
 * files. 1.25x area is roughly 1.12x in each dimension — comfortably past the
 * point where the difference shows on a library card, while ignoring the
 * near-ties that would otherwise nag the user about a swap worth nothing.
 */
export const UPGRADE_AREA_RATIO = 1.25;

/** True when the coffee has no usable photo of its own yet. */
export function beanNeedsPhoto(bean: Pick<CoffeeBean, 'photoId'>): boolean {
  return !bean.photoId;
}

function area(dim: PhotoDimensions): number {
  // Defensive: a record written by an older build, or a decode that reported
  // nothing, must not divide by zero and declare a bogus landslide win.
  if (!Number.isFinite(dim.widthPx) || !Number.isFinite(dim.heightPx)) return 0;
  if (dim.widthPx <= 0 || dim.heightPx <= 0) return 0;
  return dim.widthPx * dim.heightPx;
}

export interface PhotoComparison {
  /** Candidate area divided by current area. `0` when either cannot be measured. */
  ratio: number;
  /** True when the candidate is enough sharper to be worth offering. */
  isUpgrade: boolean;
}

/**
 * Compares a found image against the one the coffee already has.
 *
 * Resolution is the only criterion. "Better" is otherwise a matter of taste — a
 * studio render is not objectively an improvement on a photo of the bag on the
 * user's own counter — so the choice is put to the user, and this only decides
 * whether the question is worth asking at all.
 */
export function comparePhotoResolution(
  current: PhotoDimensions | null,
  candidate: PhotoDimensions,
): PhotoComparison {
  const candidateArea = area(candidate);
  const currentArea = current ? area(current) : 0;
  // Nothing measurable on either side: treat it as a non-upgrade rather than
  // steamroll the user's photo on no evidence.
  if (candidateArea === 0 || currentArea === 0) return { ratio: 0, isUpgrade: false };

  const ratio = candidateArea / currentArea;
  return { ratio, isUpgrade: ratio >= UPGRADE_AREA_RATIO };
}

/** Dimensions of a stored photo, or `null` when it is missing or unreadable. */
export async function getPhotoDimensions(
  photoId: string | undefined,
): Promise<PhotoDimensions | null> {
  if (!photoId) return null;
  try {
    const photo = await db.photos.get(photoId);
    if (!photo) return null;
    return { widthPx: photo.widthPx, heightPx: photo.heightPx };
  } catch (err) {
    console.warn('Could not read photo dimensions', photoId, err);
    return null;
  }
}

/**
 * Fetches and normalises `imageUrl` without storing it, so the caller can
 * inspect the result — chiefly its resolution — before committing.
 *
 * Returns `null` when the image could not be used, which callers are expected
 * to treat as "no photo this time" rather than an error.
 */
export async function preparePhotoFromUrl(imageUrl: string): Promise<StagedPhoto | null> {
  try {
    const { dataUrl } = await fetchImage({ url: imageUrl });

    const [resized, thumb] = await Promise.all([
      resizeDataUrl(dataUrl, 1600),
      createThumbnail(dataUrl, 160),
    ]);

    return {
      blob: dataUrlToBlob(resized.dataUrl),
      thumbnailDataUrl: thumb.dataUrl,
      widthPx: resized.width,
      heightPx: resized.height,
    };
  } catch (err) {
    // Swallowed by design — see the rules at the top of this file. A roaster
    // that blocks our user agent, serves a broken asset, or simply has no
    // picture must not fail an import that otherwise succeeded. Logged because
    // a silent no-op here is otherwise indistinguishable from "no image found".
    console.warn('Could not prepare enrichment photo', imageUrl, err);
    return null;
  }
}

/** Writes a staged image to the photo store and returns the bean fields for it. */
export async function commitStagedPhoto(staged: StagedPhoto): Promise<PhotoUpdate> {
  const photoId = ulid();
  await db.photos.add({
    id: photoId,
    schemaVersion: 1,
    kind: 'bag',
    mimeType: staged.blob.type,
    blob: staged.blob,
    widthPx: staged.widthPx,
    heightPx: staged.heightPx,
    byteSize: staged.blob.size,
    createdAt: new Date().toISOString(),
  });
  await enqueueUpsert('photo', photoId);
  return { photoId, thumbnailDataUrl: staged.thumbnailDataUrl };
}

/**
 * Fetches `imageUrl`, stores it as a `PhotoBlob`, and returns the fields to
 * merge into the bean. Returns `null` when the image could not be used.
 */
export async function attachPhotoFromUrl(imageUrl: string): Promise<PhotoUpdate | null> {
  const staged = await preparePhotoFromUrl(imageUrl);
  if (!staged) return null;
  try {
    return await commitStagedPhoto(staged);
  } catch (err) {
    console.warn('Could not store enrichment photo', imageUrl, err);
    return null;
  }
}

/**
 * Deletes a photo once nothing points at it any more, after its owner has been
 * repointed at a replacement.
 *
 * Mirrors the orphan rules in `services/beans/delete.ts`: beans are normally
 * one-to-one with their photo, but an import or a duplicated bean can share
 * one, and a cup photo can be referenced by a rating. Dropping a still-shared
 * blob would leave another record showing a broken image, so a swap leaks the
 * old photo rather than risk that.
 *
 * Returns true when the photo was actually removed.
 */
export async function releasePhotoIfOrphaned(photoId: string | undefined): Promise<boolean> {
  if (!photoId) return false;
  try {
    return await db.transaction(
      'rw',
      [db.beans, db.ratings, db.photos, db.ocrResults, db.outbox],
      async () => {
        const stillOwned = await db.beans.filter((b) => b.photoId === photoId).count();
        if (stillOwned > 0) return false;
        const stillRated = await db.ratings.filter((r) => r.cupPhotoId === photoId).count();
        if (stillRated > 0) return false;

        const ocrIds = await db.ocrResults.where('photoId').equals(photoId).primaryKeys();
        await db.ocrResults.bulkDelete(ocrIds);
        await db.photos.delete(photoId);
        await enqueueDelete('photo', photoId);
        return true;
      },
    );
  } catch (err) {
    // A leaked blob costs storage; throwing here would cost the user the photo
    // swap they just asked for, which has already succeeded by this point.
    console.warn('Could not release replaced photo', photoId, err);
    return false;
  }
}
