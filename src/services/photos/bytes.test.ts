import { describe, expect, it } from 'vitest';

import { hasPhotoBytes } from './bytes';

describe('hasPhotoBytes', () => {
  it('accepts a blob with content', () => {
    expect(hasPhotoBytes(new Blob(['imagedata'], { type: 'image/webp' }))).toBe(true);
  });

  // What sync writes for a row it has metadata for but no bytes. An object URL
  // over this decodes to nothing and renders as a broken image.
  it('rejects the zero-length placeholder sync writes', () => {
    expect(hasPhotoBytes(new Blob([], { type: 'application/octet-stream' }))).toBe(false);
  });

  it('rejects a missing blob', () => {
    expect(hasPhotoBytes(undefined)).toBe(false);
  });

  /**
   * A blob that will not say how big it is gets the benefit of the doubt.
   * `fake-indexeddb` is the case that exists today — it returns stored blobs
   * without a `size` — but the reasoning is not about the test double: blanking
   * out a photo we cannot measure is a worse outcome than showing one whose
   * bytes are still on their way.
   */
  it('accepts a blob that does not report a size', () => {
    expect(hasPhotoBytes({ type: 'image/webp' } as unknown as Blob)).toBe(true);
  });
});
