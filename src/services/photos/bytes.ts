/**
 * Whether a stored photo actually holds its bytes.
 *
 * Sync replicates photo *metadata* through Cosmos and the bytes through Blob
 * Storage, on separate schedules. A row pulled from another device therefore
 * lands with a zero-length blob (`services/sync/apply.ts`) and stays that way
 * until backfill fetches the real thing. Size is the marker for "row present,
 * bytes still to come": no extra column, and no way for the two to disagree.
 *
 * This lives on its own, imported by both the sync engine and the UI, because
 * the two used to disagree about it. Sync knew an empty blob meant "not here
 * yet"; the rendering path only checked that *a* blob existed, so it built an
 * object URL over zero bytes and handed the browser an image it could not
 * decode. The result was a broken-image icon where a photo should be and —
 * worse — a non-null URL that beat the perfectly good thumbnail those call
 * sites fall back to. It showed up wherever the bytes had not arrived: a second
 * device, or the same phone's home-screen app, which iOS gives a storage jar of
 * its own separate from Safari's.
 *
 * Note the test for zero specifically, rather than "has a positive size". Only
 * a blob we can see is empty is treated as pending; a blob that declines to
 * report its size at all is taken at face value. Absence of a size is not
 * evidence of absence of bytes, and guessing the other way would blank out real
 * photos — which is a worse failure than briefly showing one that is still
 * arriving.
 */
export function hasPhotoBytes(blob: Blob | undefined): blob is Blob {
  return blob !== undefined && blob.size !== 0;
}
