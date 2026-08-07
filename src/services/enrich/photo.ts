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
 *  1. A photo the user supplied is never replaced. Enrichment fills gaps.
 *  2. Failure is never fatal. A missing image is a cosmetic loss, so it must not
 *     take down the metadata enrichment happening alongside it.
 */
import { ulid } from 'ulid';
import { fetchImage } from '@/services/ai';
import { db } from '@/services/db';
import { createThumbnail, dataUrlToBlob, resizeDataUrl } from '@/services/image/imagePipeline';
import type { CoffeeBean } from '@/types';

/** The fields an attached photo contributes to the bean record. */
export interface PhotoUpdate {
  photoId: string;
  thumbnailDataUrl: string;
}

/** True when the coffee has no usable photo of its own yet. */
export function beanNeedsPhoto(bean: Pick<CoffeeBean, 'photoId'>): boolean {
  return !bean.photoId;
}

/**
 * Fetches `imageUrl`, stores it as a `PhotoBlob`, and returns the fields to
 * merge into the bean. Returns `null` when the image could not be used, which
 * callers are expected to treat as "no photo this time" rather than an error.
 */
export async function attachPhotoFromUrl(imageUrl: string): Promise<PhotoUpdate | null> {
  try {
    const { dataUrl } = await fetchImage({ url: imageUrl });

    const [resized, thumb] = await Promise.all([
      resizeDataUrl(dataUrl, 1600),
      createThumbnail(dataUrl, 160),
    ]);
    const blob = dataUrlToBlob(resized.dataUrl);

    const photoId = ulid();
    await db.photos.add({
      id: photoId,
      schemaVersion: 1,
      kind: 'bag',
      mimeType: blob.type,
      blob,
      widthPx: resized.width,
      heightPx: resized.height,
      byteSize: blob.size,
      createdAt: new Date().toISOString(),
    });

    return { photoId, thumbnailDataUrl: thumb.dataUrl };
  } catch (err) {
    // Swallowed by design — see the rules at the top of this file. A roaster
    // that blocks our user agent, serves a broken asset, or simply has no
    // picture must not fail an import that otherwise succeeded. Logged because
    // a silent no-op here is otherwise indistinguishable from "no image found".
    console.warn('Could not attach enrichment photo', imageUrl, err);
    return null;
  }
}
