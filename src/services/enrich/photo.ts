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
import type { CoffeeBean, PhotoBlob, PhotoKind } from '@/types';

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
 * Runs an image through the storage pipeline without writing it.
 *
 * The single place a picture becomes a `StagedPhoto`, whichever way it arrived
 * — fetched from a roaster's page, chosen off the device, or taken with the
 * camera. Keeping one implementation is what makes those indistinguishable
 * downstream: same WebP encoding, same 1600px ceiling, same thumbnail.
 */
export async function preparePhotoFromDataUrl(dataUrl: string): Promise<StagedPhoto> {
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
}

/**
 * Reads a file the user chose and stages it.
 *
 * Unlike the URL path this does *not* swallow failures. A picture the user
 * picked themselves is the whole point of the interaction, so a file that
 * cannot be read has to be reported rather than quietly ignored.
 */
export async function preparePhotoFromFile(file: File): Promise<StagedPhoto> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
  return preparePhotoFromDataUrl(dataUrl);
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
    return await preparePhotoFromDataUrl(dataUrl);
  } catch (err) {
    // Swallowed by design — see the rules at the top of this file. A roaster
    // that blocks our user agent, serves a broken asset, or simply has no
    // picture must not fail an import that otherwise succeeded. Logged because
    // a silent no-op here is otherwise indistinguishable from "no image found".
    console.warn('Could not prepare enrichment photo', imageUrl, err);
    return null;
  }
}

/**
 * Fetches `imageUrl` and returns it as a data URL for display only.
 *
 * Two reasons this exists rather than pointing an `<img>` at the roaster's own
 * URL. The content security policy allows `img-src 'self' data: blob:`, so a
 * third-party host would simply be blocked; and going through `/api/image`
 * keeps the user's browsing off the roaster's logs. Nothing is written to the
 * photo store, which is what makes it safe on the "Will I like it?" screen —
 * that screen must not save the coffee it was asked about.
 *
 * Sized for a preview, not for keeping: `preparePhotoFromUrl` is still the way
 * in when the image is going to be stored.
 *
 * Returns `null` when the image could not be used, which callers should treat
 * as "no picture this time" rather than an error.
 */
export async function previewImageFromUrl(imageUrl: string, maxPx = 800): Promise<string | null> {
  try {
    const { dataUrl } = await fetchImage({ url: imageUrl });
    const resized = await resizeDataUrl(dataUrl, maxPx);
    return resized.dataUrl;
  } catch (err) {
    console.warn('Could not load preview image', imageUrl, err);
    return null;
  }
}

/** Optional provenance for a photo about to be written. */ export interface CommitOptions {
  /** Defaults to `bag`: everything that comes through here is a picture of one. */
  kind?: PhotoKind;
  /** The photo this one was generated from. Only meaningful for `bag-studio`. */
  sourcePhotoId?: string;
}

/** Writes a staged image to the photo store and returns the bean fields for it. */
export async function commitStagedPhoto(
  staged: StagedPhoto,
  options: CommitOptions = {},
): Promise<PhotoUpdate> {
  const photoId = ulid();
  await db.photos.add({
    id: photoId,
    schemaVersion: 1,
    kind: options.kind ?? 'bag',
    mimeType: staged.blob.type,
    blob: staged.blob,
    widthPx: staged.widthPx,
    heightPx: staged.heightPx,
    byteSize: staged.blob.size,
    createdAt: new Date().toISOString(),
    ...(options.sourcePhotoId ? { sourcePhotoId: options.sourcePhotoId } : {}),
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
 * Stores a photo the user supplied and points the coffee at it.
 *
 * The order matters and is the opposite of the obvious one: the new photo is
 * written *first*, the bean is repointed second, and only then is the outgoing
 * photo released. A failure at any step leaves the coffee showing the picture
 * it had rather than none at all — which is the whole risk of replacing a photo
 * that was fine.
 *
 * Unlike the automated path there is no resolution test. Deciding a user's own
 * photo is not good enough would be answering a question they already answered
 * by choosing it.
 */
export async function setBeanPhoto(bean: CoffeeBean, staged: StagedPhoto): Promise<PhotoUpdate> {
  const previousPhotoId = bean.photoId;
  const update = await commitStagedPhoto(staged);

  await db.beans.update(bean.id, { ...update, updatedAt: new Date().toISOString() });
  await enqueueUpsert('bean', bean.id);

  // Only now does the old photo look like the orphan it has become.
  if (previousPhotoId && previousPhotoId !== update.photoId) {
    await releasePhotoIfOrphaned(previousPhotoId);
  }

  return update;
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
 * Studio shots add a third owner and a second direction. A generated photo
 * *references* the photograph it was drawn from, which keeps that original alive
 * even though no bean points at it — otherwise the first swap after a re-shoot
 * would silently destroy the only real picture of the bag. And releasing a
 * generated photo releases the original with it, since nothing else was ever
 * going to.
 *
 * Returns true when the photo was actually removed.
 */
export async function releasePhotoIfOrphaned(photoId: string | undefined): Promise<boolean> {
  if (!photoId) return false;
  try {
    const released = await db.transaction(
      'rw',
      [db.beans, db.ratings, db.photos, db.ocrResults, db.outbox],
      async () => {
        const photo = await db.photos.get(photoId);
        const stillOwned = await db.beans.filter((b) => b.photoId === photoId).count();
        if (stillOwned > 0) return null;
        const stillRated = await db.ratings.filter((r) => r.cupPhotoId === photoId).count();
        if (stillRated > 0) return null;
        // A studio shot still standing is a claim on its original: reverting it
        // has to have something to revert to.
        const stillReferenced = await db.photos.where('sourcePhotoId').equals(photoId).count();
        if (stillReferenced > 0) return null;

        const ocrIds = await db.ocrResults.where('photoId').equals(photoId).primaryKeys();
        await db.ocrResults.bulkDelete(ocrIds);
        await db.photos.delete(photoId);
        await enqueueDelete('photo', photoId);
        return photo ?? null;
      },
    );

    if (!released) return false;

    // Recursed rather than inlined so the original goes through the same owner
    // checks: it may well still belong to a bean of its own, if a duplicate
    // import left two coffees sharing one picture.
    if (released.kind === 'bag-studio' && released.sourcePhotoId) {
      await releasePhotoIfOrphaned(released.sourcePhotoId);
    }
    return true;
  } catch (err) {
    // A leaked blob costs storage; throwing here would cost the user the photo
    // swap they just asked for, which has already succeeded by this point.
    console.warn('Could not release replaced photo', photoId, err);
    return false;
  }
}
