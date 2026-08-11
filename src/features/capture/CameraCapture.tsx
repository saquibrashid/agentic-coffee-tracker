/**
 * In-app camera: live preview and a shutter button (issue #145).
 *
 * Deliberately does no persistence of its own. It hands back a JPEG data URL
 * and the page it sits in feeds that into the same pipeline a file upload uses,
 * so there is exactly one photo path to reason about.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { captureFrame, CameraError, startCameraStream, stopCameraStream } from '@/services/camera';

export interface CameraCaptureProps {
  /** Called with a JPEG data URL of the captured frame. */
  onCapture: (dataUrl: string) => void;
  /** Called when the user backs out without taking a photo. */
  onCancel: () => void;
}

export function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  /**
   * Releasing the camera is the one thing that must happen on every exit, so
   * it lives in a single callback that unmount, cancel and capture all share.
   * `stopCameraStream` tolerates a second call, which matters because unmount
   * can race a cancel the user just tapped.
   */
  const release = useCallback(() => {
    stopCameraStream(streamRef.current);
    streamRef.current = null;
  }, []);

  useEffect(() => {
    // `cancelled` guards the gap between the permission prompt appearing and
    // the user answering it: they can navigate away while it is open, and the
    // stream then arrives after unmount. Without this the camera would be left
    // running with nothing on screen and no reference left to stop it.
    let cancelled = false;

    async function open() {
      try {
        const stream = await startCameraStream();
        if (cancelled) {
          stopCameraStream(stream);
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Autoplay is unreliable when the element is mounted in the same
          // tick the stream is attached, and a silent failure looks exactly
          // like a broken camera. This is a user-gesture-initiated stream, so
          // the play() is allowed; the catch is for the harmless AbortError
          // raised when the element unmounts mid-play.
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof CameraError ? err.message : 'The camera could not be opened. Try again.',
        );
      }
    }

    void open();

    return () => {
      cancelled = true;
      release();
    };
  }, [release]);

  function handleShutter() {
    const video = videoRef.current;
    if (!video) return;

    try {
      const dataUrl = captureFrame(video);
      // Release before handing the frame up: the parent immediately starts
      // resizing and writing to IndexedDB, and holding the camera open through
      // that leaves the recording light on for no reason.
      release();
      onCapture(dataUrl);
    } catch (err) {
      setError(err instanceof CameraError ? err.message : 'That photo could not be taken.');
    }
  }

  function handleCancel() {
    release();
    onCancel();
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
        <Button type="button" variant="outline" onClick={handleCancel}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-muted relative overflow-hidden rounded-md">
        <video
          ref={videoRef}
          className="max-h-80 w-full object-contain"
          playsInline
          muted
          // The preview carries no information a screen reader user can act on,
          // and the shutter button below is the actual control.
          aria-hidden="true"
        />
      </div>

      <p role="status" className="text-muted-foreground text-sm">
        {ready ? 'Point at the bag label and take the photo.' : 'Starting the camera…'}
      </p>

      <div className="flex gap-2">
        <Button type="button" onClick={handleShutter} disabled={!ready}>
          <Camera aria-hidden="true" className="mr-2 h-4 w-4" />
          Take photo
        </Button>
        <Button type="button" variant="outline" onClick={handleCancel}>
          <X aria-hidden="true" className="mr-2 h-4 w-4" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
