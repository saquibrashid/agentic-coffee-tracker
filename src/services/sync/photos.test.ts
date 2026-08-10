import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import type { PhotoBlob } from '@/types';

import { PhotoMissingError, PhotoQuotaError } from './api';
import type * as syncApi from './api';
import { backfillPhotos, downloadPhoto, needsBackfill, uploadPhoto } from './photos';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof syncApi>('./api');
  return {
    ...actual,
    photoUploadUrl: vi.fn(),
    photoDownloadUrl: vi.fn(),
  };
});

const api = await import('./api');
const photoUploadUrl = vi.mocked(api.photoUploadUrl);
const photoDownloadUrl = vi.mocked(api.photoDownloadUrl);

/**
 * `fake-indexeddb` does not round-trip `Blob`: a stored blob comes back as an
 * opaque object with no `size`. Every assertion about bytes therefore happens
 * at the write boundary — a spy on `db.photos.put` — never on what a read
 * returns.
 */
function photo(id: string, bytes: number, mimeType = 'image/webp'): PhotoBlob {
  return {
    id,
    schemaVersion: 1,
    kind: 'bag',
    mimeType,
    blob: new Blob([new Uint8Array(bytes)], { type: mimeType }),
    widthPx: 800,
    heightPx: 600,
    byteSize: bytes,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(async () => {
  await db.photos.clear();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

/**
 * Installs in-memory rows in place of the Dexie reads.
 *
 * Necessary rather than merely convenient: a blob written to `fake-indexeddb`
 * comes back with no `size`, which is the one property the placeholder check
 * depends on. Storing the rows for real would make every photo look like it
 * already had bytes.
 */
function seed(rows: PhotoBlob[]): void {
  const byId = new Map(rows.map((row) => [row.id, row]));
  // Cast through `unknown`: Dexie's signatures return `PromiseExtended`, and
  // reproducing that just to hand back a resolved value would add nothing.
  vi.spyOn(db.photos, 'each').mockImplementation(((fn: (row: PhotoBlob) => void) => {
    for (const row of rows) fn(row);
    return Promise.resolve();
  }) as unknown as typeof db.photos.each);
  vi.spyOn(db.photos, 'get').mockImplementation(((id: string) =>
    Promise.resolve(byId.get(id))) as unknown as typeof db.photos.get);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fetchMock() {
  return vi.mocked(globalThis.fetch);
}

/**
 * jsdom's `Response` cannot wrap a `Blob` (`object.stream is not a function`),
 * so these stand in for the two response shapes this module reads. Only `ok`,
 * `status` and `blob()` are ever touched.
 */
function statusResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

function blobResponse(bytes: number): Response {
  const blob = new Blob([new Uint8Array(bytes)]);
  return { ok: true, status: 200, blob: () => Promise.resolve(blob) } as unknown as Response;
}

describe('needsBackfill', () => {
  it('treats a zero-length blob as bytes still to come', () => {
    // `apply.ts` writes exactly this placeholder for a pulled photo, so size is
    // the marker and there is no separate flag that could disagree with it.
    expect(needsBackfill(photo('p1', 0))).toBe(true);
    expect(needsBackfill(photo('p1', 10))).toBe(false);
  });
});

describe('uploadPhoto', () => {
  it('PUTs the bytes to the granted URL as a block blob', async () => {
    photoUploadUrl.mockResolvedValue({
      url: 'https://storage.example/photos/user-a/p1?sig=x',
      expiresAt: '2026-01-01T00:15:00.000Z',
      quota: { used: 100, limit: 1000 },
    });
    fetchMock().mockResolvedValue(statusResponse(201));

    const result = await uploadPhoto(photo('p1', 50));

    expect(photoUploadUrl).toHaveBeenCalledWith('p1', 50);
    const [url, init] = fetchMock().mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://storage.example/photos/user-a/p1?sig=x');
    expect(init.method).toBe('PUT');
    // Blob Storage rejects a creating PUT without this header outright.
    expect((init.headers as Record<string, string>)['x-ms-blob-type']).toBe('BlockBlob');
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/webp');
    // The grant reports usage before this upload, so the reported total has to
    // include it or the UI lags one photo behind forever.
    expect(result).toEqual({ used: 150, limit: 1000 });
  });

  it('propagates a quota refusal without attempting the upload', async () => {
    photoUploadUrl.mockRejectedValue(new PhotoQuotaError({ used: 990, limit: 1000 }));

    await expect(uploadPhoto(photo('p1', 50))).rejects.toBeInstanceOf(PhotoQuotaError);
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('throws when storage rejects the bytes', async () => {
    photoUploadUrl.mockResolvedValue({
      url: 'https://storage.example/p1',
      expiresAt: '2026-01-01T00:15:00.000Z',
      quota: { used: 0, limit: 1000 },
    });
    fetchMock().mockResolvedValue(statusResponse(403));

    await expect(uploadPhoto(photo('p1', 50))).rejects.toThrow(/403/);
  });
});

describe('downloadPhoto', () => {
  it('writes fetched bytes over the placeholder', async () => {
    seed([photo('p1', 0)]);
    photoDownloadUrl.mockResolvedValue({
      url: 'https://storage.example/p1?sig=x',
      expiresAt: '2026-01-01T00:15:00.000Z',
    });
    fetchMock().mockResolvedValue(blobResponse(64));
    const put = vi.spyOn(db.photos, 'put');

    await expect(downloadPhoto('p1')).resolves.toBe(true);

    const written = put.mock.calls[0]?.[0] as PhotoBlob;
    expect(written.blob.size).toBe(64);
    // byteSize is what the storage-usage UI adds up, so it must track the bytes
    // actually held rather than whatever the originating device reported.
    expect(written.byteSize).toBe(64);
  });

  it('reports absent bytes without writing or throwing', async () => {
    seed([photo('p1', 0)]);
    photoDownloadUrl.mockRejectedValue(new PhotoMissingError('p1'));
    const put = vi.spyOn(db.photos, 'put');

    await expect(downloadPhoto('p1')).resolves.toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it('does not resurrect a row deleted while the fetch was in flight', async () => {
    photoDownloadUrl.mockResolvedValue({
      url: 'https://storage.example/p1',
      expiresAt: '2026-01-01T00:15:00.000Z',
    });
    fetchMock().mockResolvedValue(blobResponse(64));
    const put = vi.spyOn(db.photos, 'put');

    // No local row: a delete replicated from another device between the pull
    // that queued this backfill and the fetch completing.
    await expect(downloadPhoto('p1')).resolves.toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it('leaves real local bytes alone', async () => {
    seed([photo('p1', 32)]);
    photoDownloadUrl.mockResolvedValue({
      url: 'https://storage.example/p1',
      expiresAt: '2026-01-01T00:15:00.000Z',
    });
    fetchMock().mockResolvedValue(blobResponse(64));
    const put = vi.spyOn(db.photos, 'put');

    await expect(downloadPhoto('p1')).resolves.toBe(true);
    expect(put).not.toHaveBeenCalled();
  });
});

describe('backfillPhotos', () => {
  beforeEach(() => {
    photoDownloadUrl.mockResolvedValue({
      url: 'https://storage.example/p',
      expiresAt: '2026-01-01T00:15:00.000Z',
    });
    fetchMock().mockResolvedValue(blobResponse(8));
  });

  it('fills only the placeholders', async () => {
    seed([photo('p1', 0), photo('p2', 16), photo('p3', 0)]);

    await expect(backfillPhotos()).resolves.toBe(2);
    expect(photoDownloadUrl).toHaveBeenCalledTimes(2);
  });

  it('caps the work per cycle', async () => {
    seed([photo('p1', 0), photo('p2', 0), photo('p3', 0)]);

    // A device signing in against a large library would otherwise open one
    // request per photo, all for images the user is not waiting on.
    await expect(backfillPhotos(2)).resolves.toBe(2);
    expect(photoDownloadUrl).toHaveBeenCalledTimes(2);
  });

  it('never rejects when a photo fails', async () => {
    seed([photo('p1', 0), photo('p2', 0)]);
    photoDownloadUrl.mockRejectedValueOnce(new Error('storage down'));

    // Failing the cycle over a thumbnail would stop record sync, which matters
    // far more; the placeholder survives, so the next cycle retries.
    await expect(backfillPhotos()).resolves.toBe(1);
  });

  it('does nothing when there are no placeholders', async () => {
    seed([photo('p1', 16)]);

    await expect(backfillPhotos()).resolves.toBe(0);
    expect(photoDownloadUrl).not.toHaveBeenCalled();
  });
});
