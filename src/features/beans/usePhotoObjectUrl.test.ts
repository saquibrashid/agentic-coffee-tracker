import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import type { PhotoBlob } from '@/types';
import { usePhotoObjectUrl } from './usePhotoObjectUrl';

const createObjectURL = vi.fn(() => 'blob:fake');
const revokeObjectURL = vi.fn();

function photo(id: string, bytes: number): PhotoBlob {
  return {
    id,
    schemaVersion: 1,
    kind: 'bag',
    mimeType: 'image/webp',
    blob: new Blob([new Uint8Array(bytes)], { type: 'image/webp' }),
    widthPx: 800,
    heightPx: 600,
    byteSize: bytes,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * Serves rows from memory rather than Dexie.
 *
 * `fake-indexeddb` does not round-trip `Blob` — a stored blob comes back with
 * no `size`, which is the one property this hook now depends on. Storing for
 * real would make every photo look like a placeholder, and the test would pass
 * for the wrong reason.
 */
function seed(rows: PhotoBlob[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return vi
    .spyOn(db.photos, 'get')
    .mockImplementation(((id: string) =>
      Promise.resolve(byId.get(id))) as unknown as typeof db.photos.get);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('usePhotoObjectUrl', () => {
  it('serves an object URL for a photo that has bytes', async () => {
    seed([photo('p1', 2048)]);

    const { result } = renderHook(() => usePhotoObjectUrl({ kind: 'stored', photoId: 'p1' }));

    await waitFor(() => expect(result.current).toBe('blob:fake'));
  });

  /**
   * The regression. A photo pulled from another device — or into the iOS
   * home-screen app, which gets a storage jar of its own, separate from
   * Safari's — exists as a row with a zero-length blob until backfill fetches
   * the bytes. An object URL over that is an image the browser cannot decode,
   * so it renders as a broken icon; worse, being non-null it takes precedence
   * over the thumbnail every caller falls back to.
   */
  it('reports nothing for a row whose bytes have not arrived yet', async () => {
    const get = seed([photo('p2', 0)]);

    const { result } = renderHook(() => usePhotoObjectUrl({ kind: 'stored', photoId: 'p2' }));

    await waitFor(() => expect(get).toHaveBeenCalledWith('p2'));
    expect(result.current).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('reports nothing when there is no such photo at all', async () => {
    const get = seed([]);

    const { result } = renderHook(() => usePhotoObjectUrl({ kind: 'stored', photoId: 'gone' }));

    await waitFor(() => expect(get).toHaveBeenCalledWith('gone'));
    expect(result.current).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('applies the same rule to a blob handed in directly', async () => {
    const { result } = renderHook(() => usePhotoObjectUrl({ kind: 'blob', blob: new Blob([]) }));

    await waitFor(() => expect(result.current).toBeNull());
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('does not touch the database while disabled', async () => {
    const get = seed([photo('p3', 2048)]);

    const { result } = renderHook(() =>
      usePhotoObjectUrl({ kind: 'stored', photoId: 'p3' }, false),
    );

    await waitFor(() => expect(result.current).toBeNull());
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
