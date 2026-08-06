import { describe, it, expect } from 'vitest';
import { dataUrlToBlob, byteSizeOfDataUrl } from './imagePipeline';

const onePixelPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAE0lEQVR42mNk+M9QzwAEYgJ/k9QxGQAAAABJRU5ErkJggg==';

describe('imagePipeline utils', () => {
  it('converts dataURL to Blob', async () => {
    const blob = dataUrlToBlob(onePixelPng);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('computes byte size for data url', () => {
    const size = byteSizeOfDataUrl(onePixelPng);
    expect(size).toBeGreaterThan(0);
  });
});
