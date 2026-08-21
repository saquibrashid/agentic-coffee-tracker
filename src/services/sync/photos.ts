/**
 * Photo bytes over the wire.
 *
 * Bytes go directly between the browser and Blob Storage; the BFF only ever
 * issues the short-lived credential to move them with. See `api/src/lib/blob.ts`
 * for why, and `specs/sync.md` -> Photos for the ordering rules this module
 * exists to uphold.
 */
import { db } from '@/services/db';
import { hasPhotoBytes } from '@/services/photos/bytes';
import type { PhotoBlob } from '@/types';
import { PhotoMissingError, type QuotaInfo, photoDownloadUrl, photoUploadUrl } from './api';

/**
 * How many placeholders to fill per cycle.
 *
 * Backfill is deliberately rate-limited: a device signing in against a large
 * library would otherwise open hundreds of concurrent range requests, and the
 * user is looking at thumbnails they already have. Spreading the work over
 * cycles costs latency nobody is waiting on.
 */
const BACKFILL_BATCH = 8;

/**
 * A pulled photo record arrives with a zero-length blob (`apply.ts`), because
 * metadata replicates through Cosmos and bytes do not. Size is therefore the
 * marker for "row present, bytes still to come" — no extra column needed, and
 * no way for the two to disagree.
 *
 * Shares its definition with the rendering path, which has to make the same
 * judgement and once made it differently — see `services/photos/bytes.ts`.
 */
export function needsBackfill(photo: PhotoBlob): boolean {
  return !hasPhotoBytes(photo.blob);
}

/**
 * Uploads one photo's bytes and reports the quota afterwards.
 *
 * Throws `PhotoQuotaError` when there is no room; callers must treat that as a
 * condition to report rather than a cycle failure.
 */
export async function uploadPhoto(photo: PhotoBlob): Promise<QuotaInfo> {
  const grant = await photoUploadUrl(photo.id, photo.blob.size);

  const response = await fetch(grant.url, {
    method: 'PUT',
    headers: {
      // Required by Blob Storage for every PUT that creates a blob; without it
      // the service rejects the request outright.
      'x-ms-blob-type': 'BlockBlob',
      'content-type': photo.mimeType,
    },
    body: photo.blob,
  });

  if (!response.ok) {
    throw new Error(`Photo upload failed: ${response.status}`);
  }

  return {
    // The grant reports usage *before* this upload; adding it locally keeps the
    // number honest without a second round trip to re-list the container.
    used: grant.quota.used + photo.blob.size,
    limit: grant.quota.limit,
  };
}

/**
 * Fetches one photo's bytes and stores them over the placeholder.
 *
 * Returns false when the server has no bytes for that id, which is a legitimate
 * state — the uploading device may still be offline — and not an error.
 */
export async function downloadPhoto(photoId: string): Promise<boolean> {
  let url: string;
  try {
    ({ url } = await photoDownloadUrl(photoId));
  } catch (err) {
    if (err instanceof PhotoMissingError) return false;
    throw err;
  }

  const response = await fetch(url);
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Photo download failed: ${response.status}`);

  const blob = await response.blob();
  const existing = await db.photos.get(photoId);
  // The row can vanish between the pull and the fetch — a delete replicating
  // from another device. Writing the bytes back would resurrect it.
  if (!existing) return false;
  // And the local device may have supplied real bytes in the meantime, which
  // are the same bytes but avoid a pointless write.
  if (!needsBackfill(existing)) return true;

  await db.photos.put({ ...existing, blob, byteSize: blob.size });
  return true;
}

/**
 * Fills in missing bytes for photos pulled from another device.
 *
 * Never rejects: backfill is opportunistic, and a photo that cannot be fetched
 * this cycle is simply retried next cycle. Returns the number filled.
 */
export async function backfillPhotos(limit = BACKFILL_BATCH): Promise<number> {
  const pending: PhotoBlob[] = [];
  await db.photos.each((photo) => {
    if (pending.length < limit && needsBackfill(photo)) pending.push(photo);
  });

  let filled = 0;
  for (const photo of pending) {
    try {
      if (await downloadPhoto(photo.id)) filled += 1;
    } catch {
      // Deliberately swallowed. The placeholder stays, so the next cycle picks
      // this photo up again; failing the cycle over a thumbnail would stop
      // record sync, which matters far more.
    }
  }
  return filled;
}
