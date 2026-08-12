/**
 * Re-shooting a coffee's bag photo as a studio product shot.
 *
 * The picture on a coffee is whatever could be got: a roaster's product shot
 * pulled by enrichment, or a photo the user took of the bag on a counter. Both
 * are legible and neither is nice to look at in a grid. This sends the existing
 * image to an image model with an instruction to keep the packaging exactly as
 * it is and change only the presentation, and offers the result back as a
 * replacement the user chooses to accept.
 *
 * Three rules hold everything else up:
 *
 *  1. **A generated photo is decoration, never evidence.** The model can quietly
 *     alter a logo or a word. Details parsed off an invented label would be
 *     indistinguishable from real ones, so a `bag-studio` photo is marked as
 *     such and excluded from every extraction path — see `sourcePhotoFor`, which
 *     is what those paths are expected to read instead.
 *  2. **The original is kept.** Applying a studio shot repoints the coffee; it
 *     does not release the photo it replaced, unlike every other swap in the
 *     app. That original is what a revert puts back and what any future re-parse
 *     must use.
 *  3. **Nothing is applied silently.** A generated photo is more a matter of
 *     taste than a sharper one, and it costs money per image, so it is staged
 *     and previewed and only written when someone says yes.
 */
import { ApiError, generateStudioPhoto } from '@/services/ai';
import { blobToBase64 } from '@/services/ai/pipeline';
import { db } from '@/services/db';
import { createThumbnail } from '@/services/image/imagePipeline';
import { enqueueUpsert } from '@/services/sync/outbox';
import { ulid } from 'ulid';
import {
  commitStagedPhoto,
  preparePhotoFromDataUrl,
  releasePhotoIfOrphaned,
  type PhotoUpdate,
  type StagedPhoto,
} from './photo';
import type { CoffeeBean, PhotoBlob } from '@/types';

/** True when this image was drawn by a model rather than taken of the bag. */
export function isGeneratedPhoto(photo: Pick<PhotoBlob, 'kind'> | undefined): boolean {
  return photo?.kind === 'bag-studio';
}

/**
 * The photograph behind a stored image — itself, unless it was generated, in
 * which case the one it was generated from.
 *
 * **This is the function every extraction path must call.** OCR, `/api/parse`
 * and anything that reads details off a picture want the real photograph, and
 * asking for it by id is not enough once a coffee's `photoId` can point at a
 * re-drawn image. Returns `null` when the only image left is generated and its
 * original has gone, which callers must treat as "no photo to read" rather than
 * falling back to the generated one.
 */
export async function sourcePhotoFor(photoId: string | undefined): Promise<PhotoBlob | null> {
  if (!photoId) return null;
  const photo = await db.photos.get(photoId);
  if (!photo) return null;
  if (!isGeneratedPhoto(photo)) return photo;
  if (!photo.sourcePhotoId) return null;
  const original = await db.photos.get(photo.sourcePhotoId);
  // Defensive: a chain of generated images should not exist — a studio shot is
  // never re-shot — but following one blindly would be a way to launder an
  // invented label into the extraction path.
  return original && !isGeneratedPhoto(original) ? original : null;
}

/** Raised when there is nothing to re-shoot, which is a UI state rather than a fault. */
export class NoPhotoToReshootError extends Error {
  constructor() {
    super('This coffee has no photo to re-shoot yet.');
    this.name = 'NoPhotoToReshootError';
  }
}

/**
 * A failure that will happen again identically: the model refused this picture,
 * or the request was malformed. The queue drops these rather than paying to
 * retry them hourly.
 */
export function isTerminalStudioFailure(err: unknown): boolean {
  if (err instanceof NoPhotoToReshootError) return true;
  // 429 is the rate limiter asking us to wait, which is exactly what backoff is
  // for; every other 4xx is a refusal that repeats.
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429;
}

/** A generated image held in memory, not yet written or applied. */
export interface StudioPhotoCandidate {
  staged: StagedPhoto;
  /** The photo it was generated from, which the applied record points back at. */
  sourcePhotoId: string;
  /** `mock-image` means the BFF has no image deployment and echoed the source back. */
  provider: 'azure-mai' | 'mock-image';
}

/**
 * Generates a studio shot for `bean` and stages it, without writing anything.
 *
 * Always generated from the *original* photograph, never from a studio shot the
 * coffee already has. Re-shooting a re-shoot would compound whatever the model
 * got wrong the first time, and the second result would be two generations away
 * from the bag it claims to show.
 */
export async function prepareStudioPhoto(
  bean: Pick<CoffeeBean, 'photoId'>,
): Promise<StudioPhotoCandidate> {
  const original = await sourcePhotoFor(bean.photoId);
  if (!original) throw new NoPhotoToReshootError();

  const result = await generateStudioPhoto({
    imageBase64: await blobToBase64(original.blob),
    mimeType: original.mimeType,
  });

  // Through the same pipeline as every other arriving picture: same WebP
  // encoding, same 1600px ceiling, same 160px thumbnail. A generated image is
  // just another arrival.
  const staged = await preparePhotoFromDataUrl(result.dataUrl);
  return { staged, sourcePhotoId: original.id, provider: result.provider };
}

/**
 * Writes a staged studio shot and points the coffee at it.
 *
 * The order matches `setBeanPhoto` and for the same reason: the new photo is
 * written first and the bean repointed second, so a failure part-way leaves the
 * coffee showing the picture it had.
 *
 * What differs is what is *not* done. The outgoing photo is not released when it
 * is the original photograph — that is evidence, and keeping it is what makes
 * `revertStudioPhoto` and any future re-parse possible. Only a previous
 * generated shot, which is disposable by definition, is cleaned up.
 */
export async function applyStudioPhoto(
  bean: CoffeeBean,
  candidate: StudioPhotoCandidate,
): Promise<PhotoUpdate> {
  const previous = bean.photoId ? await db.photos.get(bean.photoId) : undefined;

  const update = await commitStagedPhoto(candidate.staged, {
    kind: 'bag-studio',
    sourcePhotoId: candidate.sourcePhotoId,
  });

  await db.beans.update(bean.id, { ...update, updatedAt: new Date().toISOString() });
  await enqueueUpsert('bean', bean.id);

  if (previous && isGeneratedPhoto(previous) && previous.id !== update.photoId) {
    await releasePhotoIfOrphaned(previous.id);
  }

  return update;
}

/** True when this coffee is showing a generated photo it could be reverted from. */
export async function canRevertStudioPhoto(bean: Pick<CoffeeBean, 'photoId'>): Promise<boolean> {
  if (!bean.photoId) return false;
  const photo = await db.photos.get(bean.photoId);
  if (!isGeneratedPhoto(photo) || !photo?.sourcePhotoId) return false;
  return (await db.photos.get(photo.sourcePhotoId)) !== undefined;
}

/**
 * Puts the original photograph back and discards the generated one.
 *
 * The thumbnail has to be rebuilt rather than remembered: nothing stores the
 * original's thumbnail once the bean stopped pointing at it, and a bean whose
 * `thumbnailDataUrl` still showed the studio shot would keep it on every library
 * card while the detail page showed the photograph.
 *
 * Returns false when there is nothing to revert to.
 */
export async function revertStudioPhoto(bean: CoffeeBean): Promise<boolean> {
  if (!bean.photoId) return false;
  const generated = await db.photos.get(bean.photoId);
  if (!isGeneratedPhoto(generated) || !generated?.sourcePhotoId) return false;

  const original = await db.photos.get(generated.sourcePhotoId);
  if (!original) return false;

  // Rebuilt from the stored bytes with the same helper the extraction path
  // uses, rather than a second FileReader of its own.
  const dataUrl = `data:${original.mimeType};base64,${await blobToBase64(original.blob)}`;
  const thumb = await createThumbnail(dataUrl, 160);

  await db.beans.update(bean.id, {
    photoId: original.id,
    thumbnailDataUrl: thumb.dataUrl,
    updatedAt: new Date().toISOString(),
  });
  await enqueueUpsert('bean', bean.id);

  // Only now is the generated image unreferenced. It is safe to drop outright —
  // it can always be generated again, which is the opposite of the original's
  // situation.
  await releasePhotoIfOrphaned(generated.id);
  return true;
}

export interface StudioQueueResult {
  /** Coffees with a photograph that has never been re-shot. */
  eligible: number;
  /** Re-shoots actually queued — eligible coffees minus those already queued. */
  queued: number;
}

/**
 * The coffees a bulk re-shoot would generate an image for.
 *
 * Deliberately exact rather than approximate. Every one of these is a billed
 * image, so the number shown to the user before they agree has to be the number
 * that will actually be generated — not a count of coffees with photos, which
 * would include the ones already re-shot.
 */
async function findReshootable(): Promise<CoffeeBean[]> {
  const beans = await db.beans.toArray();
  const withPhotos = beans.filter((bean) => !bean.isArchived && bean.photoId);
  if (withPhotos.length === 0) return [];

  const photos = await db.photos.bulkGet(withPhotos.map((bean) => bean.photoId!));
  return withPhotos.filter((_, index) => {
    const photo = photos[index];
    // Already showing a studio shot, or pointing at a photo that has gone.
    return photo !== undefined && !isGeneratedPhoto(photo);
  });
}

export async function countReshootableBeans(): Promise<number> {
  return (await findReshootable()).length;
}

/**
 * Queues a re-shoot for every coffee still showing an un-generated photo.
 *
 * Queued rather than run inline because a whole imported library is a long job,
 * and the queue already has the retry, the backoff and the visible list of
 * pending work. Unlike enrichment it is never queued automatically: each task
 * spends money, so something has to have asked.
 */
export async function queueStudioPhotos(): Promise<StudioQueueResult> {
  const eligible = await findReshootable();

  const queuedTasks = await db.pendingAiTasks.where('type').equals('studio-photo').toArray();
  const alreadyQueued = new Set(queuedTasks.map((task) => task.beanId));

  const now = new Date().toISOString();
  const tasks = eligible
    .filter((bean) => !alreadyQueued.has(bean.id))
    .map((bean) => ({
      id: ulid(),
      schemaVersion: 1 as const,
      type: 'studio-photo' as const,
      payload: { reason: 'bulk' },
      beanId: bean.id,
      attempts: 0,
      createdAt: now,
    }));

  if (tasks.length > 0) await db.pendingAiTasks.bulkAdd(tasks);

  return { eligible: eligible.length, queued: tasks.length };
}
