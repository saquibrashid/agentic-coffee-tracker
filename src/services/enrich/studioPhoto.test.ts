import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import { ApiError } from '@/services/ai';
import {
  applyStudioPhoto,
  canRevertStudioPhoto,
  countReshootableBeans,
  isGeneratedPhoto,
  isTerminalStudioFailure,
  NoPhotoToReshootError,
  prepareStudioPhoto,
  queueStudioPhotos,
  revertStudioPhoto,
  sourcePhotoFor,
} from './studioPhoto';
import type * as AiModule from '@/services/ai';
import type { CoffeeBean, PhotoBlob } from '@/types';

vi.mock('@/services/ai', async () => {
  const actual = await vi.importActual<typeof AiModule>('@/services/ai');
  return { ...actual, generateStudioPhoto: vi.fn() };
});

vi.mock('@/services/ai/pipeline', () => ({
  blobToBase64: vi.fn(async () => 'c291cmNl'),
}));

vi.mock('@/services/image/imagePipeline', () => ({
  resizeDataUrl: vi.fn(async (dataUrl: string, _maxWidth?: number, mimeType?: string) => ({
    dataUrl: mimeType === 'image/jpeg' ? 'data:image/jpeg;base64,Y29udmVydGVk' : dataUrl,
    width: 1024,
    height: 1024,
  })),
  createThumbnail: vi.fn(async () => ({ dataUrl: 'data:image/webp;base64,thumb' })),
  dataUrlToBlob: vi.fn(() => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })),
}));

const { generateStudioPhoto } = vi.mocked(await import('@/services/ai'));

function photo(id: string, overrides: Partial<PhotoBlob> = {}): PhotoBlob {
  return {
    id,
    schemaVersion: 1,
    kind: 'bag',
    mimeType: 'image/webp',
    blob: new Blob(['bytes'], { type: 'image/webp' }),
    widthPx: 800,
    heightPx: 600,
    byteSize: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function bean(id: string, photoId?: string, overrides: Partial<CoffeeBean> = {}): CoffeeBean {
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
    ...overrides,
  } as CoffeeBean;
}

function generated() {
  return { dataUrl: 'data:image/png;base64,gen', contentType: 'image/png', byteSize: 9 };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([
    db.photos.clear(),
    db.beans.clear(),
    db.ratings.clear(),
    db.ocrResults.clear(),
    db.outbox.clear(),
    db.pendingAiTasks.clear(),
  ]);
});

describe('sourcePhotoFor', () => {
  it('returns a real photograph unchanged', async () => {
    await db.photos.add(photo('p1'));
    await expect(sourcePhotoFor('p1')).resolves.toMatchObject({ id: 'p1' });
  });

  it('returns the original behind a generated photo', async () => {
    await db.photos.bulkAdd([
      photo('original'),
      photo('studio', { kind: 'bag-studio', sourcePhotoId: 'original' }),
    ]);
    await expect(sourcePhotoFor('studio')).resolves.toMatchObject({ id: 'original' });
  });

  it('refuses a generated photo whose original has gone', async () => {
    // The whole point of the guard: a redrawn label must never reach OCR, and
    // "no photo to read" is the safe answer when the real one is missing.
    await db.photos.add(photo('studio', { kind: 'bag-studio', sourcePhotoId: 'gone' }));
    await expect(sourcePhotoFor('studio')).resolves.toBeNull();
  });

  it('refuses to follow a chain of generated photos', async () => {
    await db.photos.bulkAdd([
      photo('first', { kind: 'bag-studio' }),
      photo('second', { kind: 'bag-studio', sourcePhotoId: 'first' }),
    ]);
    await expect(sourcePhotoFor('second')).resolves.toBeNull();
  });
});

describe('prepareStudioPhoto', () => {
  it('stages the generated image without writing anything', async () => {
    await db.photos.add(photo('p1'));
    generateStudioPhoto.mockResolvedValue({ ...generated(), provider: 'azure-mai' });

    const candidate = await prepareStudioPhoto(bean('b1', 'p1'));

    expect(candidate.sourcePhotoId).toBe('p1');
    expect(candidate.staged.thumbnailDataUrl).toBe('data:image/webp;base64,thumb');
    // Staged, not stored: only the original is in the table.
    await expect(db.photos.count()).resolves.toBe(1);
  });

  it('always re-shoots the original, never a studio shot', async () => {
    await db.photos.bulkAdd([
      photo('original'),
      photo('studio', { kind: 'bag-studio', sourcePhotoId: 'original' }),
    ]);
    generateStudioPhoto.mockResolvedValue({ ...generated(), provider: 'azure-mai' });

    const candidate = await prepareStudioPhoto(bean('b1', 'studio'));

    expect(candidate.sourcePhotoId).toBe('original');
  });

  it('refuses a coffee with no photo', async () => {
    await expect(prepareStudioPhoto(bean('b1'))).rejects.toBeInstanceOf(NoPhotoToReshootError);
    expect(generateStudioPhoto).not.toHaveBeenCalled();
  });

  // The pipeline stores everything as WebP and the model takes only JPEG or
  // PNG, so without this every re-shoot in the app fails upstream.
  it('converts a stored WebP to JPEG before sending it', async () => {
    await db.photos.add(photo('p1'));
    generateStudioPhoto.mockResolvedValue({ ...generated(), provider: 'azure-mai' });

    await prepareStudioPhoto(bean('b1', 'p1'));

    expect(generateStudioPhoto).toHaveBeenCalledWith({
      imageBase64: 'Y29udmVydGVk',
      mimeType: 'image/jpeg',
    });
  });

  it('sends a JPEG as it is rather than re-encoding it', async () => {
    await db.photos.add(
      photo('p1', { mimeType: 'image/jpeg', blob: new Blob(['b'], { type: 'image/jpeg' }) }),
    );
    generateStudioPhoto.mockResolvedValue({ ...generated(), provider: 'azure-mai' });

    await prepareStudioPhoto(bean('b1', 'p1'));

    expect(generateStudioPhoto).toHaveBeenCalledWith({
      imageBase64: 'c291cmNl',
      mimeType: 'image/jpeg',
    });
  });
});

describe('applyStudioPhoto', () => {
  it('marks the stored photo as generated and points it at the original', async () => {
    await db.photos.add(photo('p1'));
    const b = bean('b1', 'p1');
    await db.beans.add(b);
    generateStudioPhoto.mockResolvedValue({ ...generated(), provider: 'azure-mai' });

    const update = await applyStudioPhoto(b, await prepareStudioPhoto(b));

    const stored = await db.photos.get(update.photoId);
    expect(stored?.kind).toBe('bag-studio');
    expect(stored?.sourcePhotoId).toBe('p1');
    expect((await db.beans.get('b1'))?.photoId).toBe(update.photoId);
  });

  it('keeps the original photograph rather than releasing it', async () => {
    await db.photos.add(photo('p1'));
    const b = bean('b1', 'p1');
    await db.beans.add(b);
    generateStudioPhoto.mockResolvedValue({ ...generated(), provider: 'azure-mai' });

    await applyStudioPhoto(b, await prepareStudioPhoto(b));

    // Unlike every other swap in the app. The original is evidence: a re-parse
    // must read it, and a revert must have something to put back.
    await expect(db.photos.get('p1')).resolves.toBeDefined();
  });

  it('discards a studio shot it replaces', async () => {
    await db.photos.bulkAdd([
      photo('original'),
      photo('old-studio', { kind: 'bag-studio', sourcePhotoId: 'original' }),
    ]);
    const b = bean('b1', 'old-studio');
    await db.beans.add(b);
    generateStudioPhoto.mockResolvedValue({ ...generated(), provider: 'azure-mai' });

    await applyStudioPhoto(b, await prepareStudioPhoto(b));

    await expect(db.photos.get('old-studio')).resolves.toBeUndefined();
    // Releasing the outgoing studio shot must not take the original with it —
    // the replacement still points at it.
    await expect(db.photos.get('original')).resolves.toBeDefined();
  });
});

describe('revertStudioPhoto', () => {
  it('points the coffee back at the original and drops the generated one', async () => {
    await db.photos.bulkAdd([
      photo('original'),
      photo('studio', { kind: 'bag-studio', sourcePhotoId: 'original' }),
    ]);
    const b = bean('b1', 'studio', { thumbnailDataUrl: 'data:image/webp;base64,studio-thumb' });
    await db.beans.add(b);

    await expect(revertStudioPhoto(b)).resolves.toBe(true);

    const after = await db.beans.get('b1');
    expect(after?.photoId).toBe('original');
    // Rebuilt, not remembered: a stale thumbnail would keep the studio shot on
    // every library card while the detail page showed the photograph.
    expect(after?.thumbnailDataUrl).toBe('data:image/webp;base64,thumb');
    await expect(db.photos.get('studio')).resolves.toBeUndefined();
    await expect(db.photos.get('original')).resolves.toBeDefined();
  });

  it('does nothing for a coffee showing its own photo', async () => {
    await db.photos.add(photo('p1'));
    const b = bean('b1', 'p1');
    await db.beans.add(b);

    await expect(revertStudioPhoto(b)).resolves.toBe(false);
    await expect(db.photos.get('p1')).resolves.toBeDefined();
  });
});

describe('canRevertStudioPhoto', () => {
  it('is false when the original is gone', async () => {
    await db.photos.add(photo('studio', { kind: 'bag-studio', sourcePhotoId: 'gone' }));
    await expect(canRevertStudioPhoto(bean('b1', 'studio'))).resolves.toBe(false);
  });

  it('is true when the original survives', async () => {
    await db.photos.bulkAdd([
      photo('original'),
      photo('studio', { kind: 'bag-studio', sourcePhotoId: 'original' }),
    ]);
    await expect(canRevertStudioPhoto(bean('b1', 'studio'))).resolves.toBe(true);
  });
});

describe('countReshootableBeans', () => {
  it('counts only coffees showing a photo that has not been re-shot', async () => {
    await db.photos.bulkAdd([
      photo('p1'),
      photo('p2'),
      photo('studio', { kind: 'bag-studio', sourcePhotoId: 'p2' }),
    ]);
    await db.beans.bulkAdd([
      bean('has-photo', 'p1'),
      bean('already-shot', 'studio'),
      bean('no-photo'),
      bean('archived', 'p1', { isArchived: true }),
      bean('dangling', 'missing'),
    ]);

    // Every one of these is a billed image, so the number the user is shown has
    // to be the number that will actually be generated.
    await expect(countReshootableBeans()).resolves.toBe(1);
  });
});

describe('queueStudioPhotos', () => {
  it('queues one task per eligible coffee', async () => {
    await db.photos.add(photo('p1'));
    await db.beans.bulkAdd([bean('b1', 'p1'), bean('b2', 'p1')]);

    await expect(queueStudioPhotos()).resolves.toEqual({ eligible: 2, queued: 2 });
    await expect(db.pendingAiTasks.count()).resolves.toBe(2);
  });

  it('does not queue a coffee twice', async () => {
    await db.photos.add(photo('p1'));
    await db.beans.add(bean('b1', 'p1'));
    await queueStudioPhotos();

    await expect(queueStudioPhotos()).resolves.toEqual({ eligible: 1, queued: 0 });
    await expect(db.pendingAiTasks.count()).resolves.toBe(1);
  });
});

describe('isTerminalStudioFailure', () => {
  it('treats a refusal as terminal but a rate limit as retryable', () => {
    expect(isTerminalStudioFailure(new ApiError('refused', 422))).toBe(true);
    expect(isTerminalStudioFailure(new NoPhotoToReshootError())).toBe(true);
    // Waiting is exactly what backoff is for, and the request was never served.
    expect(isTerminalStudioFailure(new ApiError('slow down', 429))).toBe(false);
    expect(isTerminalStudioFailure(new ApiError('boom', 500))).toBe(false);
    expect(isTerminalStudioFailure(new Error('offline'))).toBe(false);
  });
});

describe('isGeneratedPhoto', () => {
  it('recognises only studio shots', () => {
    expect(isGeneratedPhoto({ kind: 'bag-studio' })).toBe(true);
    expect(isGeneratedPhoto({ kind: 'bag' })).toBe(false);
    expect(isGeneratedPhoto({ kind: 'cup' })).toBe(false);
    expect(isGeneratedPhoto(undefined)).toBe(false);
  });
});
