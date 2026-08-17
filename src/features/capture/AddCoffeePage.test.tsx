import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';

/**
 * Proves the join between the in-app camera and the photo pipeline (issue
 * #145): a captured frame has to be persisted exactly like an uploaded file, or
 * the camera quietly becomes a second, weaker code path that misses the offline
 * queueing the upload path already gets right.
 */

const mocks = vi.hoisted(() => ({
  extractBeanFromPhoto: vi.fn(),
  resizeDataUrl: vi.fn(),
  createThumbnail: vi.fn(),
  dataUrlToBlob: vi.fn(),
}));

vi.mock('@/services/ai/pipeline', () => ({
  extractBeanFromPhoto: mocks.extractBeanFromPhoto,
  PipelineUnavailableError: class PipelineUnavailableError extends Error {},
}));

vi.mock('@/services/image/imagePipeline', () => ({
  resizeDataUrl: mocks.resizeDataUrl,
  createThumbnail: mocks.createThumbnail,
  dataUrlToBlob: mocks.dataUrlToBlob,
}));

const { AddCoffeePage } = await import('./AddCoffeePage');

const stop = vi.fn();

function useCamera(available: boolean) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: available
      ? { getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop }] })) }
      : undefined,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  useCamera(true);

  mocks.resizeDataUrl.mockResolvedValue({
    dataUrl: 'data:image/jpeg;base64,resized',
    width: 1600,
    height: 1200,
  });
  mocks.createThumbnail.mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,thumb' });
  mocks.dataUrlToBlob.mockReturnValue(new Blob(['x'], { type: 'image/jpeg' }));
  mocks.extractBeanFromPhoto.mockResolvedValue({
    parsed: null,
    rawText: 'ONYX SOUTHERN WEATHER',
    model: 'gpt-4o',
  });

  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/jpeg;base64,frame',
  );
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    value: 640,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    value: 480,
  });

  await Promise.all([db.beans.clear(), db.photos.clear(), db.outbox.clear()]);
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('AddCoffeePage camera', () => {
  it('offers an in-app camera when the device has one', () => {
    render(<AddCoffeePage />);

    expect(screen.getByRole('button', { name: /take a photo/i })).toBeInTheDocument();
  });

  it('hides the camera button where it could only ever fail', () => {
    // Insecure origin or no camera hardware. A button that always errors is
    // worse than no button.
    useCamera(false);

    render(<AddCoffeePage />);

    expect(screen.queryByRole('button', { name: /take a photo/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/photo of the coffee bag/i)).toBeInTheDocument();
  });

  it('no longer suppresses the photo library on iOS', () => {
    // `capture="environment"` made iOS Safari drop the "Photo Library" choice
    // entirely, so an existing photo of a bag could not be used. With a real
    // camera button there is no reason to keep taking that choice away.
    render(<AddCoffeePage />);

    expect(screen.getByLabelText(/choose a photo/i)).not.toHaveAttribute('capture');
  });

  it('saves a captured frame through the same pipeline an upload uses', async () => {
    render(<AddCoffeePage />);

    await userEvent.click(screen.getByRole('button', { name: /take a photo/i }));
    await screen.findByRole('status');
    await userEvent.click(screen.getByRole('button', { name: /take photo/i }));

    await waitFor(async () => {
      expect(await db.photos.count()).toBe(1);
      expect(await db.beans.count()).toBe(1);
    });

    const bean = (await db.beans.toArray())[0];
    expect(bean?.source).toBe('photo-ocr');
    expect(bean?.needsReview).toBe(true);
    expect(bean?.thumbnailDataUrl).toBe('data:image/jpeg;base64,thumb');
    // The frame went through the shared resize rather than being stored raw.
    expect(mocks.resizeDataUrl).toHaveBeenCalledWith('data:image/jpeg;base64,frame', 1600);
  });

  it('queues the capture for sync like any other photo', async () => {
    render(<AddCoffeePage />);

    await userEvent.click(screen.getByRole('button', { name: /take a photo/i }));
    await screen.findByRole('status');
    await userEvent.click(screen.getByRole('button', { name: /take photo/i }));

    await waitFor(async () => {
      const queued = await db.outbox.toArray();
      expect(queued.map((entry) => entry.type).sort()).toEqual(['bean', 'photo']);
    });
  });

  it('returns to the upload form when the user cancels the camera', async () => {
    render(<AddCoffeePage />);

    await userEvent.click(screen.getByRole('button', { name: /take a photo/i }));
    await screen.findByRole('status');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.getByRole('button', { name: /take a photo/i })).toBeInTheDocument();
    expect(await db.beans.count()).toBe(0);
  });
});

/**
 * Paste parity (issue #194): a screenshot of a product page is the fastest
 * thing a user already has, and making them save it to disk first is a step the
 * app can simply remove.
 */
describe('AddCoffeePage paste', () => {
  function pasteImage(file: File) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }], files: [file] },
    });
    act(() => {
      document.dispatchEvent(event);
    });
    return event;
  }

  it('saves a pasted image through the same pipeline an upload uses', async () => {
    render(<AddCoffeePage />);

    pasteImage(new File(['image'], 'screenshot.png', { type: 'image/png' }));

    await waitFor(async () => {
      expect(await db.photos.count()).toBe(1);
      expect(await db.beans.count()).toBe(1);
    });
    const bean = (await db.beans.toArray())[0];
    expect(bean?.source).toBe('photo-ocr');
    expect(mocks.resizeDataUrl).toHaveBeenCalledWith(expect.stringContaining('data:'), 1600);
  });

  it('leaves a text paste to the link field', async () => {
    render(<AddCoffeePage />);

    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [] },
    });
    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(await db.beans.count()).toBe(0);
  });
});
