import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CameraCapture } from './CameraCapture';

/**
 * The camera service tests prove the rules; this proves the lifecycle — that
 * the hardware is actually released on every way out of the component. A leaked
 * MediaStream leaves the recording light on after the user has moved on, which
 * no amount of correct capture logic makes acceptable.
 */

const stop = vi.fn();
let getUserMedia: ReturnType<typeof vi.fn>;

function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop }] } as unknown as MediaStream;
}

beforeEach(() => {
  stop.mockClear();
  getUserMedia = vi.fn(() => Promise.resolve(fakeStream()));
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });

  // jsdom implements neither, and both are called on mount.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/jpeg;base64,frame',
  );
  // videoWidth is read-only on the prototype, so the frame size has to be
  // installed rather than assigned.
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    value: 640,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    value: 480,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('CameraCapture', () => {
  it('opens the camera and enables the shutter once it is running', async () => {
    render(<CameraCapture onCapture={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByRole('status')).toHaveTextContent(/point at the bag/i);
    expect(screen.getByRole('button', { name: /take photo/i })).toBeEnabled();
  });

  it('keeps the shutter disabled until the stream is live', () => {
    // Capturing before the first frame arrives would save a blank image.
    render(<CameraCapture onCapture={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('button', { name: /take photo/i })).toBeDisabled();
  });

  it('hands the captured frame up as a data URL', async () => {
    const onCapture = vi.fn();
    render(<CameraCapture onCapture={onCapture} onCancel={vi.fn()} />);
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: /take photo/i }));

    expect(onCapture).toHaveBeenCalledWith('data:image/jpeg;base64,frame');
  });

  it('releases the camera after taking a photo', async () => {
    // The parent immediately starts resizing and writing to IndexedDB; holding
    // the camera open through that keeps the light on for no reason.
    render(<CameraCapture onCapture={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: /take photo/i }));

    expect(stop).toHaveBeenCalled();
  });

  it('releases the camera when the user cancels', async () => {
    const onCancel = vi.fn();
    render(<CameraCapture onCapture={vi.fn()} onCancel={onCancel} />);
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(stop).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('releases the camera on unmount', async () => {
    const { unmount } = render(<CameraCapture onCapture={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByRole('status');

    unmount();

    expect(stop).toHaveBeenCalled();
  });

  it('releases a stream that arrives after the component has gone', async () => {
    // The gap between the permission prompt appearing and being answered is
    // real time during which the user can navigate away. Without a guard the
    // stream lands with nothing on screen and no reference left to stop it.
    let grant: (stream: MediaStream) => void = () => {};
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );

    const { unmount } = render(<CameraCapture onCapture={vi.fn()} onCancel={vi.fn()} />);
    unmount();
    grant(fakeStream());

    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it('explains a denied permission instead of dead-ending', async () => {
    const denied = new Error('Permission denied');
    denied.name = 'NotAllowedError';
    getUserMedia.mockRejectedValue(denied);

    render(<CameraCapture onCapture={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/blocked/i);
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
  });

  it('says so specifically when there is no camera at all', async () => {
    const missing = new Error('no device');
    missing.name = 'NotFoundError';
    getUserMedia.mockRejectedValue(missing);

    render(<CameraCapture onCapture={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no camera was found/i);
  });

  it('lets the user back out of an error without a stuck screen', async () => {
    const denied = new Error('nope');
    denied.name = 'NotAllowedError';
    getUserMedia.mockRejectedValue(denied);
    const onCancel = vi.fn();

    render(<CameraCapture onCapture={vi.fn()} onCancel={onCancel} />);
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: /back/i }));

    expect(onCancel).toHaveBeenCalled();
  });
});
