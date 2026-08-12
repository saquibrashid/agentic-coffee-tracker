/**
 * Adding or replacing the picture on a coffee that already exists.
 *
 * Enrichment can find a bag shot on a roaster's page, but that only helps
 * coffees whose page was found — an import full of coffees that were never
 * matched has no pictures and no way to get any. This is the manual route: the
 * bag is on the shelf, so the surest source of a photo is the person holding
 * it.
 *
 * A photo supplied here always wins. The resolution comparison in the
 * enrichment panel exists to stop an unattended lookup trampling the user's own
 * picture with a storefront render; when the user is the one choosing, that
 * question has already been answered.
 */
import { useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CameraCapture } from '@/features/capture/CameraCapture';
import { isCameraSupported } from '@/services/camera';
import {
  preparePhotoFromDataUrl,
  preparePhotoFromFile,
  setBeanPhoto,
  type StagedPhoto,
} from '@/services/enrich/photo';
import type { CoffeeBean } from '@/types';

type Phase = 'idle' | 'reading' | 'saving';

export function PhotoPanel({ bean }: { bean: CoffeeBean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Asked once: the answer cannot change during a visit, and it decides whether
  // the camera button exists at all.
  const [cameraAvailable] = useState(() => isCameraSupported());

  const hasPhoto = Boolean(bean.thumbnailDataUrl ?? bean.photoId);

  async function store(staged: StagedPhoto) {
    setPhase('saving');
    await setBeanPhoto(bean, staged);
    // The page reads the bean through a live query, so the new picture appears
    // without anything here having to hold it.
    setJustSaved(true);
    setPhase('idle');
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setJustSaved(false);
    setPhase('reading');
    try {
      await store(await preparePhotoFromFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that photo.');
      setPhase('idle');
    } finally {
      // Clearing it means choosing the same file twice in a row still fires a
      // change event, which is otherwise a confusing dead click.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleCapture(dataUrl: string) {
    setCameraOpen(false);
    setError(null);
    setJustSaved(false);
    setPhase('reading');
    try {
      await store(await preparePhotoFromDataUrl(dataUrl));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that photo.');
      setPhase('idle');
    }
  }

  const busy = phase !== 'idle';

  /*
   * No box and no heading of its own — the CollapsibleCard on the bean page
   * supplies both. See EnrichPanel for the same note.
   */
  return (
    <div>
      {error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      )}

      {cameraOpen ? (
        <div className="mt-2">
          <CameraCapture
            onCapture={(dataUrl) => void handleCapture(dataUrl)}
            onCancel={() => setCameraOpen(false)}
          />
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <div className="flex items-start gap-3">
            {bean.thumbnailDataUrl && (
              <img
                src={bean.thumbnailDataUrl}
                alt={`${bean.name} bag`}
                className="size-20 shrink-0 rounded object-cover"
              />
            )}
            <p className="text-muted-foreground text-sm">
              {hasPhoto
                ? 'Replacing this keeps everything else about the coffee as it is.'
                : 'This coffee has no picture yet. Take one of the bag, or choose a photo you already have.'}
            </p>
          </div>

          {busy && (
            <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {phase === 'reading' ? 'Preparing your photo…' : 'Saving…'}
            </p>
          )}

          {justSaved && !busy && (
            <p role="status" className="text-sm">
              Photo saved.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {cameraAvailable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setCameraOpen(true);
                }}
              >
                <Camera aria-hidden="true" /> {hasPhoto ? 'Take a new photo' : 'Take a photo'}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus aria-hidden="true" />{' '}
              {hasPhoto ? 'Choose a different photo' : 'Choose a photo'}
            </Button>
          </div>

          {/*
            Driven by the button above so the control reads as one of the pair
            rather than a stray file input, but kept in the accessibility tree
            and labelled, so it is still reachable and nameable on its own.
          */}
          <input
            ref={fileInputRef}
            id={`bean-photo-${bean.id}`}
            aria-label={hasPhoto ? 'Choose a different photo' : 'Choose a photo'}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </div>
      )}
    </div>
  );
}
