import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CameraError,
  captureFrame,
  isCameraSupported,
  startCameraStream,
  stopCameraStream,
} from './camera';

/** A DOMException-shaped rejection, since jsdom does not throw the real ones. */
function mediaError(name: string, message = ''): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function mockGetUserMedia(impl: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(impl) },
  });
}

function removeMediaDevices() {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: undefined,
  });
}

afterEach(() => {
  removeMediaDevices();
  vi.restoreAllMocks();
});

describe('isCameraSupported', () => {
  it('is false when mediaDevices is missing, as on an insecure origin', () => {
    // Not merely unusable -- the whole namespace is undefined, which is why
    // this has to be a property check rather than a call in a try/catch.
    removeMediaDevices();

    expect(isCameraSupported()).toBe(false);
  });

  it('is true when getUserMedia is callable', () => {
    mockGetUserMedia(() => Promise.resolve({} as MediaStream));

    expect(isCameraSupported()).toBe(true);
  });
});

describe('startCameraStream', () => {
  it('asks for the rear camera without demanding it', async () => {
    // As an exact constraint this would throw OverconstrainedError on a laptop
    // whose only camera faces the user, turning a working webcam into "no
    // camera found".
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    await expect(startCameraStream()).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment' },
      audio: false,
    });
  });

  it('reports an unsupported browser rather than throwing something opaque', async () => {
    removeMediaDevices();

    await expect(startCameraStream()).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-device'],
    ['OverconstrainedError', 'no-device'],
    ['NotReadableError', 'in-use'],
    ['AbortError', 'in-use'],
    ['TypeError', 'unknown'],
  ])('classifies %s as %s', async (name, kind) => {
    mockGetUserMedia(() => Promise.reject(mediaError(name)));

    await expect(startCameraStream()).rejects.toMatchObject({ kind });
  });

  it('separates a dismissed prompt from a hard denial', async () => {
    // Chrome reports both as NotAllowedError, but they need different copy: a
    // denial will not be asked again without a settings change, a dismissal
    // just needs another tap.
    mockGetUserMedia(() =>
      Promise.reject(mediaError('NotAllowedError', 'Permission dismissed by user')),
    );

    await expect(startCameraStream()).rejects.toMatchObject({ kind: 'dismissed' });
  });

  it('always fails with an explainable message', async () => {
    mockGetUserMedia(() => Promise.reject(mediaError('NotFoundError')));

    await expect(startCameraStream()).rejects.toBeInstanceOf(CameraError);
    await expect(startCameraStream()).rejects.toThrow(/no camera was found/i);
  });
});

describe('stopCameraStream', () => {
  it('stops every track, because dropping the reference does not', () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream;

    stopCameraStream(stream);

    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('tolerates null so unmount and cancel can race', () => {
    expect(() => stopCameraStream(null)).not.toThrow();
    expect(() => stopCameraStream(undefined)).not.toThrow();
  });
});

describe('captureFrame', () => {
  let drawImage: ReturnType<typeof vi.fn>;
  let toDataURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    drawImage = vi.fn();
    toDataURL = vi.fn(() => 'data:image/jpeg;base64,frame');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
      toDataURL as unknown as HTMLCanvasElement['toDataURL'],
    );
  });

  function video(width: number, height: number): HTMLVideoElement {
    return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
  }

  it('returns a JPEG data URL', () => {
    // JPEG, not PNG: a 1600px PNG frame runs to several megabytes and these are
    // stored in IndexedDB and then synced.
    expect(captureFrame(video(640, 480))).toBe('data:image/jpeg;base64,frame');
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.9);
  });

  it('scales a large frame down to the same 1600px edge the upload path uses', () => {
    captureFrame(video(4000, 3000));

    const [, , , width, height] = drawImage.mock.calls[0] as number[];
    expect(width).toBe(1600);
    expect(height).toBe(1200);
  });

  it('never upscales a small frame', () => {
    captureFrame(video(320, 240));

    const [, , , width, height] = drawImage.mock.calls[0] as number[];
    expect(width).toBe(320);
    expect(height).toBe(240);
  });

  it('refuses a frame the camera has not produced yet', () => {
    // videoWidth is 0 until the first frame arrives; capturing then would save
    // a blank image and send it off to OCR.
    expect(() => captureFrame(video(0, 0))).toThrow(/not ready/i);
  });
});
