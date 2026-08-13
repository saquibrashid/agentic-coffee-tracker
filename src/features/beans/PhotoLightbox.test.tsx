import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import type { PhotoBlob } from '@/types';

import { PhotoThumbnail } from './PhotoLightbox';

/**
 * The thumbnail is the only picture the app ever shows. What matters here is
 * that asking for a bigger one actually produces the *stored* image rather than
 * the thumbnail scaled up, and that a coffee with nothing bigger behind it does
 * not offer a control that cannot deliver.
 */

// jsdom implements neither `showModal` nor object URLs. Without the former the
// dialog never gets its `open` attribute, and its contents stay out of the
// accessibility tree — so these tests would be querying a dialog that, as far
// as any assistive technology is concerned, is not on the page.
const createObjectURL = vi.fn(() => 'blob:full-size');
const revokeObjectURL = vi.fn();

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  globalThis.URL.createObjectURL = createObjectURL;
  globalThis.URL.revokeObjectURL = revokeObjectURL;
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
  await db.photos.clear();
});

function photo(id: string): PhotoBlob {
  return {
    id,
    schemaVersion: 1,
    kind: 'bag',
    mimeType: 'image/webp',
    blob: new Blob(['full-size-bytes'], { type: 'image/webp' }),
    widthPx: 1600,
    heightPx: 1200,
    byteSize: 15,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('PhotoThumbnail', () => {
  it('opens the stored full-size photo rather than the thumbnail', async () => {
    await db.photos.add(photo('p1'));
    render(
      <PhotoThumbnail
        source={{ kind: 'stored', photoId: 'p1' }}
        thumbnailDataUrl="data:image/webp;base64,thumb"
        alt="Night Light bag"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /view larger/i }));

    // The dialog is labelled with the alt text, so finding it by name is the
    // same check a screen reader user would make.
    const dialog = await screen.findByRole('dialog', { name: 'Night Light bag' });
    await waitFor(() =>
      expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'blob:full-size'),
    );
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it('shows the thumbnail while the stored photo is still loading', async () => {
    // A read that never settles is the only deterministic way to observe the
    // intermediate state; a real one resolves before the click even returns.
    vi.spyOn(db.photos, 'get').mockReturnValue(new Promise(() => {}) as never);
    render(
      <PhotoThumbnail
        source={{ kind: 'stored', photoId: 'p1' }}
        thumbnailDataUrl="data:image/webp;base64,thumb"
        alt="Night Light bag"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /view larger/i }));

    const dialog = screen.getByRole('dialog', { name: 'Night Light bag' });
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'data:image/webp;base64,thumb');
  });

  // The bean carries a thumbnail of its own, so a photo row that has gone
  // missing should still show something rather than an empty box.
  it('keeps the thumbnail when the stored photo has gone', async () => {
    render(
      <PhotoThumbnail
        source={{ kind: 'stored', photoId: 'missing' }}
        thumbnailDataUrl="data:image/webp;base64,thumb"
        alt="Night Light bag"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /view larger/i }));

    const dialog = await screen.findByRole('dialog', { name: 'Night Light bag' });
    await waitFor(() =>
      expect(within(dialog).getByRole('img')).toHaveAttribute(
        'src',
        'data:image/webp;base64,thumb',
      ),
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('enlarges a staged photo that has not been stored yet', async () => {
    render(
      <PhotoThumbnail
        source={{ kind: 'blob', blob: new Blob(['staged'], { type: 'image/webp' }) }}
        thumbnailDataUrl="data:image/webp;base64,thumb"
        alt="Studio shot"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /view larger/i }));

    const dialog = await screen.findByRole('dialog', { name: 'Studio shot' });
    await waitFor(() =>
      expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'blob:full-size'),
    );
  });

  it('closes when the backdrop is clicked', async () => {
    await db.photos.add(photo('p1'));
    render(
      <PhotoThumbnail
        source={{ kind: 'stored', photoId: 'p1' }}
        thumbnailDataUrl="data:image/webp;base64,thumb"
        alt="Night Light bag"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /view larger/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Night Light bag' });

    // Clicking the dialog element itself is a click on the backdrop: the
    // picture and the close button are children, and stop here by not being
    // the target.
    await userEvent.click(dialog);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('releases the object URL when closed', async () => {
    await db.photos.add(photo('p1'));
    render(
      <PhotoThumbnail
        source={{ kind: 'stored', photoId: 'p1' }}
        thumbnailDataUrl="data:image/webp;base64,thumb"
        alt="Night Light bag"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /view larger/i }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'Close photo' }));

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:full-size');
  });

  // A thumbnail with nothing behind it would enlarge to 160px of blur.
  it('is not clickable when there is no full-size image', () => {
    render(
      <PhotoThumbnail
        source={undefined}
        thumbnailDataUrl="data:image/webp;base64,thumb"
        alt="Night Light bag"
      />,
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/webp;base64,thumb');
  });

  it('renders nothing without a thumbnail', () => {
    const { container } = render(
      <PhotoThumbnail
        source={{ kind: 'stored', photoId: 'p1' }}
        thumbnailDataUrl={undefined}
        alt="Night Light bag"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
