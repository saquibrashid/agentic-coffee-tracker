/**
 * Camera access for in-app capture (issue #145).
 *
 * The file input with `capture="environment"` that this replaces is a
 * *delegation* to the OS, and it behaves differently everywhere: Android Chrome
 * opens the camera, iOS Safari opens the camera but removes the "Photo Library"
 * choice, and desktop ignores the attribute entirely — so a laptop webcam could
 * not be used at all.
 *
 * Everything here treats "no camera" as a normal outcome rather than a failure.
 * A user on an insecure origin, a desktop with no webcam, or someone who said
 * no to the permission prompt has not done anything wrong, and the UI needs to
 * be able to say so specifically rather than showing one generic error.
 */

/**
 * Why the camera is unavailable, in the user's terms.
 *
 * `denied` and `dismissed` are separated because they need different copy: a
 * hard denial means the browser will not ask again without the user changing a
 * site setting, whereas a dismissed prompt just needs another tap.
 */
export type CameraErrorKind =
  'unsupported' | 'denied' | 'dismissed' | 'no-device' | 'in-use' | 'unknown';

export class CameraError extends Error {
  readonly kind: CameraErrorKind;

  constructor(kind: CameraErrorKind, message: string) {
    super(message);
    this.name = 'CameraError';
    this.kind = kind;
  }
}

const MESSAGES: Record<CameraErrorKind, string> = {
  unsupported: 'This browser cannot open the camera. You can still choose a photo instead.',
  denied:
    'Camera access is blocked. Allow it for this site in your browser settings, or choose a photo instead.',
  dismissed: 'The camera permission was not granted. Try again, or choose a photo instead.',
  'no-device': 'No camera was found on this device. You can still choose a photo instead.',
  'in-use': 'The camera is already in use by another app. Close it and try again.',
  unknown: 'The camera could not be opened. You can still choose a photo instead.',
};

/**
 * Whether it is worth offering a camera button at all.
 *
 * `navigator.mediaDevices` is `undefined` on an insecure origin, not merely
 * unusable, so this has to be a property check rather than a call in a
 * try/catch. Offering a button that can only ever fail is worse than not
 * offering one.
 */
export function isCameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/**
 * Maps a `getUserMedia` rejection onto something explainable.
 *
 * The DOM spec names these errors but browsers disagree on which they throw:
 * Chrome reports a dismissed prompt as `NotAllowedError` just like a hard
 * denial, and Firefox has historically used `AbortError` for a camera another
 * app holds. The message is consulted only to separate cases that share a name.
 */
function classify(error: unknown): CameraError {
  const name = error instanceof Error ? error.name : '';
  const detail = error instanceof Error ? error.message : '';

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return /dismiss/i.test(detail)
        ? new CameraError('dismissed', MESSAGES.dismissed)
        : new CameraError('denied', MESSAGES.denied);
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('no-device', MESSAGES['no-device']);
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('in-use', MESSAGES['in-use']);
    default:
      return new CameraError('unknown', MESSAGES.unknown);
  }
}

/**
 * Opens the rear camera, falling back to any camera.
 *
 * `facingMode: 'environment'` is a preference rather than a requirement, which
 * matters on a laptop: as an exact constraint it would throw
 * `OverconstrainedError` on a device whose only camera faces the user, turning
 * a usable webcam into a "no camera found". Requesting it loosely lets a phone
 * pick the rear lens and a laptop still work.
 */
export async function startCameraStream(): Promise<MediaStream> {
  if (!isCameraSupported()) throw new CameraError('unsupported', MESSAGES.unsupported);

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch (error) {
    throw classify(error);
  }
}

/**
 * Releases the camera.
 *
 * Every track must be stopped individually — dropping the reference to the
 * `MediaStream` does not turn the hardware off, and a recording light left on
 * after the user has moved on is the kind of thing people uninstall an app
 * over. Safe to call twice, because unmount and an explicit cancel can race.
 */
export function stopCameraStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Longest edge of a captured frame, matching the file-upload path's resize. */
const MAX_EDGE = 1600;

/**
 * Grabs the current video frame as a JPEG data URL.
 *
 * Returns a data URL rather than a blob so the frame rejoins the *existing*
 * photo pipeline at exactly the point a file upload does, leaving resize,
 * thumbnail, persistence, OCR and the queue runner untouched.
 *
 * JPEG, not PNG: a 1600px PNG frame of a coffee bag runs to several megabytes,
 * and these are stored in IndexedDB and later synced.
 */
export function captureFrame(video: HTMLVideoElement): string {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new CameraError(
      'unknown',
      'The camera is not ready yet. Give it a moment and try again.',
    );
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const context = canvas.getContext('2d');
  if (!context) throw new CameraError('unknown', MESSAGES.unknown);

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}
