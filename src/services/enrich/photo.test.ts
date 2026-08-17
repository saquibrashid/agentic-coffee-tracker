import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import { ApiError } from '@/services/ai';
import {
  attachPhotoFromUrl,
  beanNeedsPhoto,
  commitStagedPhoto,
  comparePhotoResolution,
  getPhotoDimensions,
  preparePhotoFromUrl,
  previewImageFromUrl,
  releasePhotoIfOrphaned,
  UPGRADE_AREA_RATIO,
} from './photo';
import * as imagePipeline from '@/services/image/imagePipeline';
import type * as AiModule from '@/services/ai';
import type { CoffeeBean, PhotoBlob } from '@/types';

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
  await Promise.all([
    db.photos.clear(),
    db.beans.clear(),
    db.ratings.clear(),
    db.ocrResults.clear(),
  ]);
});

function storedPhoto(id: string, widthPx = 800, heightPx = 600): PhotoBlob {
  return {
    id,
    schemaVersion: 1,
    kind: 'bag',
    mimeType: 'image/webp',
    blob: new Blob(['x'], { type: 'image/webp' }),
    widthPx,
    heightPx,
    byteSize: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function beanWithPhoto(id: string, photoId: string): CoffeeBean {
  return {
    id,
    schemaVersion: 1,
    roaster: 'Anchorhead',
    name: `Bean ${id}`,
    photoId,
    isArchived: false,
    needsReview: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as CoffeeBean;
}

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

describe('comparePhotoResolution', () => {
  it('calls a clearly sharper image an upgrade', () => {
    const result = comparePhotoResolution(
      { widthPx: 800, heightPx: 600 },
      { widthPx: 1600, heightPx: 1200 },
    );
    expect(result.ratio).toBeCloseTo(4);
    expect(result.isUpgrade).toBe(true);
  });

  it('ignores a difference too small to see', () => {
    // 10% more in each dimension is 1.21x area — deliberately under the bar,
    // because prompting for a swap worth nothing is worse than staying quiet.
    const result = comparePhotoResolution(
      { widthPx: 1000, heightPx: 1000 },
      { widthPx: 1100, heightPx: 1100 },
    );
    expect(result.ratio).toBeCloseTo(1.21);
    expect(result.isUpgrade).toBe(false);
  });

  it('treats the threshold itself as an upgrade', () => {
    const current = { widthPx: 1000, heightPx: 1000 };
    const candidate = { widthPx: 1000, heightPx: Math.round(1000 * UPGRADE_AREA_RATIO) };
    expect(comparePhotoResolution(current, candidate).isUpgrade).toBe(true);
  });

  it('never calls an identical or smaller image an upgrade', () => {
    const current = { widthPx: 1200, heightPx: 900 };
    expect(comparePhotoResolution(current, { widthPx: 1200, heightPx: 900 }).isUpgrade).toBe(false);
    expect(comparePhotoResolution(current, { widthPx: 600, heightPx: 450 }).isUpgrade).toBe(false);
  });

  it('refuses to declare a winner when either side cannot be measured', () => {
    // A record from an older build, or a decode that reported nothing, must not
    // divide by zero and hand the user a bogus landslide.
    expect(comparePhotoResolution(null, { widthPx: 1600, heightPx: 1200 }).isUpgrade).toBe(false);
    expect(
      comparePhotoResolution({ widthPx: 0, heightPx: 0 }, { widthPx: 1600, heightPx: 1200 })
        .isUpgrade,
    ).toBe(false);
    expect(
      comparePhotoResolution({ widthPx: 800, heightPx: 600 }, { widthPx: 0, heightPx: 0 })
        .isUpgrade,
    ).toBe(false);
    expect(
      comparePhotoResolution(
        { widthPx: Number.NaN, heightPx: 600 },
        { widthPx: 1600, heightPx: 1200 },
      ).isUpgrade,
    ).toBe(false);
  });
});

describe('getPhotoDimensions', () => {
  it('reads the stored dimensions', async () => {
    await db.photos.add(storedPhoto('p1', 1024, 768));
    await expect(getPhotoDimensions('p1')).resolves.toEqual({ widthPx: 1024, heightPx: 768 });
  });

  it('returns null when there is nothing to measure', async () => {
    await expect(getPhotoDimensions(undefined)).resolves.toBeNull();
    await expect(getPhotoDimensions('missing')).resolves.toBeNull();
  });
});

describe('preparePhotoFromUrl', () => {
  it('returns the processed image without storing anything', async () => {
    fetchImage.mockResolvedValue(imageResponse('data:image/jpeg;base64,abc'));

    const staged = await preparePhotoFromUrl('https://onyx.example/bag.jpg');

    expect(staged?.widthPx).toBe(1200);
    expect(staged?.heightPx).toBe(900);
    expect(staged?.thumbnailDataUrl).toBe('data:image/webp;base64,thumb');
    // The whole point of staging: the user has not chosen yet, so nothing is written.
    await expect(db.photos.count()).resolves.toBe(0);
  });

  it('returns null when the download fails', async () => {
    fetchImage.mockRejectedValue(new ApiError('not an image', 415));
    await expect(preparePhotoFromUrl('https://onyx.example/bad.svg')).resolves.toBeNull();
  });
});

describe('previewImageFromUrl', () => {
  it('returns a data URL and writes nothing', async () => {
    // #197: "Will I like it?" shows the roaster's picture but must not save
    // the coffee it was asked about. A data URL is also the only thing the
    // content security policy will render — img-src is 'self' data: blob:, so
    // the roaster's own URL would be blocked.
    fetchImage.mockResolvedValue(imageResponse('data:image/jpeg;base64,abc'));

    const preview = await previewImageFromUrl('https://onyx.example/bag.jpg');

    expect(preview).toBe('data:image/jpeg;base64,abc');
    expect(pipeline.resizeDataUrl).toHaveBeenCalledWith('data:image/jpeg;base64,abc', 800);
    await expect(db.photos.count()).resolves.toBe(0);
  });

  it('returns null rather than failing the check it decorates', async () => {
    fetchImage.mockRejectedValue(new ApiError('blocked', 403));

    await expect(previewImageFromUrl('https://onyx.example/bag.jpg')).resolves.toBeNull();
  });
});

describe('commitStagedPhoto', () => {
  it('stores a staged image and returns the bean fields', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' });
    const result = await commitStagedPhoto({
      blob,
      thumbnailDataUrl: 'data:image/webp;base64,thumb',
      widthPx: 1600,
      heightPx: 1200,
    });

    const stored = await db.photos.get(result.photoId);
    expect(stored?.kind).toBe('bag');
    expect(stored?.widthPx).toBe(1600);
    expect(stored?.heightPx).toBe(1200);
    expect(stored?.byteSize).toBe(4);
    expect(result.thumbnailDataUrl).toBe('data:image/webp;base64,thumb');
  });
});

describe('releasePhotoIfOrphaned', () => {
  it('deletes a photo nothing points at any more', async () => {
    await db.photos.add(storedPhoto('old'));
    await db.ocrResults.add({
      id: 'o1',
      photoId: 'old',
      rawText: 'x',
      provider: 'azure-vision',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(releasePhotoIfOrphaned('old')).resolves.toBe(true);
    await expect(db.photos.get('old')).resolves.toBeUndefined();
    // The OCR result described the old bytes and is meaningless without them.
    await expect(db.ocrResults.count()).resolves.toBe(0);
  });

  it('keeps a photo another bean still shares', async () => {
    // An import or a duplicated bean can share one photo. Deleting it out from
    // under the survivor would leave that bean showing a broken image.
    await db.photos.add(storedPhoto('shared'));
    await db.beans.add(beanWithPhoto('b2', 'shared'));

    await expect(releasePhotoIfOrphaned('shared')).resolves.toBe(false);
    await expect(db.photos.get('shared')).resolves.toBeDefined();
  });

  it('keeps a photo a rating still references', async () => {
    await db.photos.add(storedPhoto('cup'));
    await db.ratings.add({
      id: 'r1',
      schemaVersion: 2,
      beanId: 'b1',
      score: 8,
      brewType: 'espresso',
      cupPhotoId: 'cup',
      ratedAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    await expect(releasePhotoIfOrphaned('cup')).resolves.toBe(false);
    await expect(db.photos.get('cup')).resolves.toBeDefined();
  });

  it('does nothing when there was no previous photo', async () => {
    await expect(releasePhotoIfOrphaned(undefined)).resolves.toBe(false);
  });
});

describe('releasePhotoIfOrphaned: studio shots', () => {
  it('keeps an original that a studio shot still points at', async () => {
    // No bean references it any more, but the generated photo showing in its
    // place has to have something to revert to -- and it is the only real
    // picture of the bag.
    await db.photos.bulkAdd([
      storedPhoto('original'),
      { ...storedPhoto('studio'), kind: 'bag-studio', sourcePhotoId: 'original' },
    ]);
    await db.beans.add(beanWithPhoto('b1', 'studio'));

    await expect(releasePhotoIfOrphaned('original')).resolves.toBe(false);
    await expect(db.photos.get('original')).resolves.toBeDefined();
  });

  it('takes the original with it when the studio shot goes', async () => {
    await db.photos.bulkAdd([
      storedPhoto('original'),
      { ...storedPhoto('studio'), kind: 'bag-studio', sourcePhotoId: 'original' },
    ]);

    await expect(releasePhotoIfOrphaned('studio')).resolves.toBe(true);
    // Nothing else was ever going to: the original stopped belonging to a bean
    // the moment the studio shot replaced it.
    await expect(db.photos.get('original')).resolves.toBeUndefined();
  });

  it('leaves an original that a surviving bean still owns', async () => {
    await db.photos.bulkAdd([
      storedPhoto('original'),
      { ...storedPhoto('studio'), kind: 'bag-studio', sourcePhotoId: 'original' },
    ]);
    await db.beans.add(beanWithPhoto('other', 'original'));

    await expect(releasePhotoIfOrphaned('studio')).resolves.toBe(true);
    await expect(db.photos.get('original')).resolves.toBeDefined();
  });
});
