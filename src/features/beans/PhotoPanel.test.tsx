import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean } from '@/types';

/**
 * A coffee whose roaster could never be found on the web has no picture and no
 * automated way to get one, so this is the only route to a photo for it. That
 * makes two things worth guarding above all: that a photo the user supplies is
 * never second-guessed, and that replacing a photo cannot leave the coffee with
 * none.
 */

const preparePhotoFromFile = vi.hoisted(() => vi.fn());
const preparePhotoFromDataUrl = vi.hoisted(() => vi.fn());
const isCameraSupported = vi.hoisted(() => vi.fn());

vi.mock('@/services/enrich/photo', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  preparePhotoFromFile,
  preparePhotoFromDataUrl,
}));

vi.mock('@/services/camera', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isCameraSupported,
}));

const { PhotoPanel } = await import('./PhotoPanel');

function makeBean(overrides: Partial<CoffeeBean> = {}): CoffeeBean {
  return {
    id: 'bean-1',
    schemaVersion: 1,
    roaster: 'Blue Bottle Coffee',
    name: 'Night Light Decaf',
    roastLevel: 'unknown',
    process: 'unknown',
    origins: [],
    tastingNotes: [],
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function staged(marker: string) {
  return {
    blob: new Blob([marker], { type: 'image/webp' }),
    thumbnailDataUrl: `data:image/webp;base64,${marker}`,
    widthPx: 1600,
    heightPx: 1200,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  isCameraSupported.mockReturnValue(false);
  preparePhotoFromFile.mockResolvedValue(staged('new'));
  preparePhotoFromDataUrl.mockResolvedValue(staged('shot'));
  await db.beans.clear();
  await db.photos.clear();
});

async function choose(file: File) {
  const input = screen.getByLabelText(/choose a/i);
  await userEvent.upload(input, file);
}

const aFile = () => new File(['jpeg-bytes'], 'bag.jpg', { type: 'image/jpeg' });

describe('PhotoPanel', () => {
  it('invites a photo when the coffee has none', () => {
    render(<PhotoPanel bean={makeBean()} />);
    expect(screen.getByText(/no picture yet/i)).toBeInTheDocument();
  });

  it('stores a chosen photo and points the coffee at it', async () => {
    const bean = makeBean();
    await db.beans.add(bean);
    render(<PhotoPanel bean={bean} />);

    await choose(aFile());

    await waitFor(() => expect(screen.getByText(/photo saved/i)).toBeInTheDocument());

    const saved = await db.beans.get('bean-1');
    expect(saved?.photoId).toBeDefined();
    expect(saved?.thumbnailDataUrl).toBe('data:image/webp;base64,new');
    await expect(db.photos.get(saved!.photoId!)).resolves.toBeDefined();
  });

  it('releases the photo it replaced', async () => {
    const bean = makeBean();
    await db.beans.add(bean);
    render(<PhotoPanel bean={bean} />);

    await choose(aFile());
    await waitFor(() => expect(screen.getByText(/photo saved/i)).toBeInTheDocument());
    const firstPhotoId = (await db.beans.get('bean-1'))!.photoId!;

    // Re-render with the bean as it now stands, the way the live query would.
    preparePhotoFromFile.mockResolvedValue(staged('second'));
    const updated = (await db.beans.get('bean-1'))!;
    render(<PhotoPanel bean={updated} />);
    const inputs = screen.getAllByLabelText(/choose a different photo/i);
    await userEvent.upload(inputs[inputs.length - 1]!, aFile());

    await waitFor(async () => {
      expect((await db.beans.get('bean-1'))!.photoId).not.toBe(firstPhotoId);
    });
    // Waited for rather than asserted outright: the release deliberately
    // happens *after* the bean is repointed, so it is not done yet at the
    // moment the new photo id appears.
    await waitFor(async () => {
      expect(await db.photos.get(firstPhotoId)).toBeUndefined();
    });
    expect(await db.photos.count()).toBe(1);
  });

  it('takes the photo as given, without weighing it against the one already there', async () => {
    // The enrichment path refuses a lower-resolution find. A deliberate choice
    // is not a find, so a small photo must still replace a large one.
    const bean = makeBean({ photoId: 'old', thumbnailDataUrl: 'data:image/webp;base64,old' });
    await db.beans.add(bean);
    await db.photos.add({
      id: 'old',
      schemaVersion: 1,
      kind: 'bag',
      mimeType: 'image/webp',
      blob: new Blob(['old'], { type: 'image/webp' }),
      widthPx: 4000,
      heightPx: 3000,
      byteSize: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    preparePhotoFromFile.mockResolvedValue({ ...staged('tiny'), widthPx: 200, heightPx: 150 });

    render(<PhotoPanel bean={bean} />);
    await choose(aFile());

    await waitFor(() => expect(screen.getByText(/photo saved/i)).toBeInTheDocument());
    expect((await db.beans.get('bean-1'))!.thumbnailDataUrl).toBe('data:image/webp;base64,tiny');
  });

  it('keeps the existing photo when the new one cannot be read', async () => {
    const bean = makeBean({ photoId: 'old', thumbnailDataUrl: 'data:image/webp;base64,old' });
    await db.beans.add(bean);
    preparePhotoFromFile.mockRejectedValue(new Error('Could not read that image.'));

    render(<PhotoPanel bean={bean} />);
    await choose(aFile());

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read that image/i);
    const after = await db.beans.get('bean-1');
    expect(after!.photoId).toBe('old');
    expect(after!.thumbnailDataUrl).toBe('data:image/webp;base64,old');
  });

  it('offers the camera only where there is one', async () => {
    render(<PhotoPanel bean={makeBean()} />);
    expect(screen.queryByRole('button', { name: /take a photo/i })).not.toBeInTheDocument();

    isCameraSupported.mockReturnValue(true);
    render(<PhotoPanel bean={makeBean()} />);
    expect(screen.getAllByRole('button', { name: /take a photo/i }).length).toBeGreaterThan(0);
  });
});
