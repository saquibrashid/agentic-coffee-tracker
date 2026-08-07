/**
 * Identifies image bytes by magic number.
 *
 * Content-Type headers lie — a roaster CDN mislabelling a PNG as
 * `application/octet-stream` is routine, and an attacker labelling HTML as
 * `image/png` is the reason this exists at all. The bytes are the only claim
 * worth trusting, so `/api/image` refuses anything not recognised here.
 */

/**
 * SVG is excluded on purpose. It is an active document — it can carry script —
 * and nothing in the app needs it: the client rasterises to WebP regardless.
 */
export const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Returns the media type the bytes actually are, or `undefined` when they are
 * not a recognised bitmap.
 */
export function sniffImageType(bytes: Buffer): string | undefined {
  // Every signature below needs at least 12 bytes to be conclusive.
  if (bytes.length < 12) return undefined;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (bytes.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';

  // WebP is a RIFF container: "RIFF" <4-byte size> "WEBP".
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }

  // AVIF is ISO-BMFF: <4-byte size> "ftyp" <brand>.
  if (bytes.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('latin1');
    if (brand.startsWith('avif') || brand.startsWith('avis')) return 'image/avif';
  }

  return undefined;
}

/** `image/jpeg; charset=binary` is common enough to be worth tolerating. */
export function normalizeContentType(raw: string): string {
  return (raw.split(';')[0] ?? '').trim().toLowerCase();
}
