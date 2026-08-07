import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import { ApiError } from '@/services/ai';
import { attachPhotoFromUrl, beanNeedsPhoto } from './photo';
import * as imagePipeline from '@/services/image/imagePipeline';
import type * as AiModule from '@/services/ai';

vi.mock('@/services/ai', async () => {
  const actual = await vi.importActual<typeof AiModule>('@/services/ai');
  return { ...actual, fetchImage: vi.fn() };
});

vi.mock('@/services/image/imagePipeline', () => ({
  resizeDataUrl: vi.fn(async (dataUrl: string) => ({ dataUrl, width: 1200, height: 900 })),
  createThumbnail: vi.fn(async () => ({ dataUrl: 'data:image/webp;base64,thumb' })),
  dataUrlToBlob: vi.fn(() => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })),
}));

const { fetchImage } = vi.mocked(await import('@/services/ai'));
const pipeline = vi.mocked(imagePipeline);

function imageResponse(dataUrl: string) {
  return { dataUrl, contentType: 'image/jpeg', byteSize: 12, sourceUrl: 'https://onyx.example/x' };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.photos.clear();
});

describe('beanNeedsPhoto', () => {
  it('is true only when no photo is stored', () => {
    expect(beanNeedsPhoto({})).toBe(true);
    expect(beanNeedsPhoto({ photoId: '' })).toBe(true);
    expect(beanNeedsPhoto({ photoId: 'p1' })).toBe(false);
  });
});

describe('attachPhotoFromUrl', () => {
  it('stores the image as a bag photo and returns the bean fields', async () => {
    fetchImage.mockResolvedValue(imageResponse('data:image/jpeg;base64,abc'));

    const result = await attachPhotoFromUrl('https://onyx.example/bag.jpg');

    expect(fetchImage).toHaveBeenCalledWith({ url: 'https://onyx.example/bag.jpg' });
    expect(result?.thumbnailDataUrl).toBe('data:image/webp;base64,thumb');

    const stored = await db.photos.get(result?.photoId ?? '');
    expect(stored?.kind).toBe('bag');
    expect(stored?.mimeType).toBe('image/webp');
    expect(stored?.widthPx).toBe(1200);
    expect(stored?.heightPx).toBe(900);
    expect(stored?.byteSize).toBe(3);
  });

  it('runs the same resize and thumbnail pipeline as a camera capture', async () => {
    fetchImage.mockResolvedValue(imageResponse('data:image/jpeg;base64,abc'));

    await attachPhotoFromUrl('https://onyx.example/bag.jpg');

    expect(pipeline.resizeDataUrl).toHaveBeenCalledWith('data:image/jpeg;base64,abc', 1600);
    expect(pipeline.createThumbnail).toHaveBeenCalledWith('data:image/jpeg;base64,abc', 160);
  });

  it('returns null and stores nothing when the download fails', async () => {
    fetchImage.mockRejectedValue(new ApiError('not an image', 415));

    await expect(attachPhotoFromUrl('https://onyx.example/bad.svg')).resolves.toBeNull();
    await expect(db.photos.count()).resolves.toBe(0);
  });

  it('returns null when the image cannot be decoded', async () => {
    // A truncated or corrupt bitmap gets past the proxy's magic-number check
    // but still fails in the browser, and must be just as survivable.
    fetchImage.mockResolvedValue(imageResponse('data:image/jpeg;base64,zzz'));
    pipeline.resizeDataUrl.mockRejectedValueOnce(new Error('decode failed'));

    await expect(attachPhotoFromUrl('https://onyx.example/broken.jpg')).resolves.toBeNull();
    await expect(db.photos.count()).resolves.toBe(0);
  });
});
