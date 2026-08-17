/**
 * Capture flow: photo -> local persist -> OCR/parse -> confirm (specs/ui.md §2).
 *
 * The bean row is written to IndexedDB *before* any network call, so an offline
 * capture is never lost; the AI work is queued and reconciled by the queue runner.
 */
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { db } from '@/services/db';
import { enqueueUpsert } from '@/services/sync/outbox';
import { createThumbnail, dataUrlToBlob, resizeDataUrl } from '@/services/image/imagePipeline';
import { extractBeanFromPhoto, PipelineUnavailableError } from '@/services/ai/pipeline';
import { parsedBeanToUpdate } from '@/services/ai/mapping';
import { EmptyPageError, enrichFromUrl } from '@/services/enrich';
import { attachPhotoFromUrl } from '@/services/enrich/photo';
import { isSchemaError } from '@/services/ai';
import { isCameraSupported } from '@/services/camera';
import { usePasteImage } from '@/hooks/usePasteImage';
import { CameraCapture } from './CameraCapture';
import { ConfirmForm } from './ConfirmForm';
import type { CoffeeBean } from '@/types';
import { ulid } from 'ulid';

type Stage = 'idle' | 'processing' | 'extracting' | 'importing' | 'confirm' | 'queued';

interface ConfirmState {
  bean: CoffeeBean;
  rawText?: string;
  schemaErrors?: string[];
  usedMock?: boolean;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

export function AddCoffeePage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  // Read once on mount rather than on every render: the answer cannot change
  // during a visit, and it decides whether a control exists at all.
  const [cameraAvailable] = useState(() => isCameraSupported());

  function reset() {
    setStage('idle');
    setPreview(null);
    setConfirmState(null);
    setError(null);
    setUrl('');
    setCameraOpen(false);
  }

  /**
   * URL import is the same shape as the photo path: persist a draft first, then
   * enrich it, then hand the user the identical confirm step. Reusing
   * `ConfirmForm` keeps the two entry points from drifting apart.
   */
  async function handleUrlImport(event: FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setStage('importing');

    const now = new Date().toISOString();
    const beanId = ulid();
    const draft: CoffeeBean = {
      id: beanId,
      schemaVersion: 1,
      roaster: 'Unknown',
      name: 'Draft from link',
      source: 'url-scrape',
      sourceUrl: trimmed,
      isArchived: false,
      needsReview: true,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const enriched = await enrichFromUrl(trimmed);
      // Best-effort: a draft with details and no picture is still a good draft,
      // so a failed image download must not lose the import.
      const photo = enriched.imageUrl ? await attachPhotoFromUrl(enriched.imageUrl) : null;
      await db.beans.add({
        ...draft,
        ...parsedBeanToUpdate(enriched.parsed),
        ...(photo ?? {}),
        sourceUrl: trimmed,
      });
      await enqueueUpsert('bean', beanId);
      const bean = await db.beans.get(beanId);
      setConfirmState({
        bean: bean ?? draft,
        rawText: enriched.rawText,
      });
      setStage('confirm');
    } catch (err) {
      // Nothing is written on failure — a half-created bean from a bad link is
      // worse than no bean, because the user has no way to tell it apart.
      if (err instanceof EmptyPageError) setError(err.message);
      else if (isSchemaError(err)) setError('We could not make sense of that page.');
      else setError(err instanceof Error ? err.message : 'Could not import from that link.');
      setStage('idle');
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await readImageFile(file);
  }

  async function readImageFile(file: File) {
    setError(null);
    setStage('processing');

    try {
      const dataUrl = await readFileAsDataUrl(file);
      await processPhoto(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong reading that photo.');
      setStage('idle');
    }
  }

  /**
   * Everything after "we have an image": resize, persist, then read the label.
   *
   * Both entry points converge here — a file the user chose and a frame taken
   * with the in-app camera — so there is one photo path to reason about and the
   * camera cannot drift away from the offline and queueing behaviour that the
   * upload path already gets right.
   */
  async function processPhoto(dataUrl: string) {
    setPreview(dataUrl);

    const [resized, thumb] = await Promise.all([
      resizeDataUrl(dataUrl, 1600),
      createThumbnail(dataUrl, 160),
    ]);
    const blob = dataUrlToBlob(resized.dataUrl);

    const now = new Date().toISOString();
    const photoId = ulid();
    const beanId = ulid();

    await db.photos.add({
      id: photoId,
      schemaVersion: 1,
      kind: 'bag',
      mimeType: blob.type,
      blob,
      widthPx: resized.width,
      heightPx: resized.height,
      byteSize: blob.size,
      createdAt: now,
    });
    await enqueueUpsert('photo', photoId);
    const draft: CoffeeBean = {
      id: beanId,
      schemaVersion: 1,
      roaster: 'Unknown',
      name: 'Draft from photo',
      source: 'photo-ocr',
      thumbnailDataUrl: thumb.dataUrl,
      photoId,
      isArchived: false,
      needsReview: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.beans.add(draft);
    await enqueueUpsert('bean', beanId);

    setStage('extracting');

    try {
      const result = await extractBeanFromPhoto(blob);
      const update: Partial<CoffeeBean> = {
        rawOcrText: result.rawText,
        updatedAt: new Date().toISOString(),
        ...(result.parsed ? parsedBeanToUpdate(result.parsed) : {}),
      };
      if (result.model) update.llmModel = result.model;
      await db.beans.update(beanId, update);
      await enqueueUpsert('bean', beanId);

      const bean = await db.beans.get(beanId);
      setConfirmState({
        bean: bean ?? { ...draft, ...update },
        rawText: result.rawText,
        usedMock: result.usedMock,
        ...(result.schemaErrors ? { schemaErrors: result.schemaErrors } : {}),
      });
      setStage('confirm');
    } catch (err) {
      if (!(err instanceof PipelineUnavailableError)) throw err;
      // Offline or BFF down: queue the OCR task and let the user move on.
      await db.pendingAiTasks.add({
        id: ulid(),
        schemaVersion: 1,
        type: 'ocr',
        payload: { photoId },
        beanId,
        attempts: 0,
        createdAt: new Date().toISOString(),
      });
      setStage('queued');
    }
  }

  async function handleCameraCapture(dataUrl: string) {
    setCameraOpen(false);
    setError(null);
    setStage('processing');

    try {
      await processPhoto(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong saving that photo.');
      setStage('idle');
    }
  }

  // Only while the page is showing its input controls: once the user is
  // confirming details, a paste belongs to the field they are typing in.
  usePasteImage((file) => void readImageFile(file), stage === 'idle' && !cameraOpen);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a coffee</CardTitle>
        <CardDescription>
          Take or upload a photo of the bag. We&apos;ll read the label and you confirm the details.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {stage === 'idle' && (
          <div>
            {cameraOpen ? (
              <CameraCapture
                onCapture={(dataUrl) => void handleCameraCapture(dataUrl)}
                onCancel={() => setCameraOpen(false)}
              />
            ) : (
              <>
                {cameraAvailable && (
                  <div className="mb-4">
                    <Button type="button" onClick={() => setCameraOpen(true)}>
                      <Camera aria-hidden="true" className="mr-2 h-4 w-4" />
                      Take a photo
                    </Button>
                  </div>
                )}

                <label htmlFor="bag-photo" className="mb-2 block text-sm font-medium">
                  {cameraAvailable ? 'Or choose a photo of the bag' : 'Photo of the coffee bag'}
                </label>
                <input
                  id="bag-photo"
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleFile(e)}
                  className="file:bg-primary file:text-primary-foreground block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:px-4 file:py-2 file:text-sm file:font-medium"
                />
                <p className="text-muted-foreground mt-2 text-sm">
                  You can also paste an image straight from your clipboard.
                </p>
                {error && (
                  <p role="alert" className="text-destructive mt-3 text-sm">
                    {error}
                  </p>
                )}
              </>
            )}

            <div className="mt-6 border-t pt-4">
              <form onSubmit={(e) => void handleUrlImport(e)}>
                <Label htmlFor="bean-url" className="mb-2 block">
                  Or import from a link
                </Label>
                <p className="text-muted-foreground mb-2 text-sm">
                  Paste the roaster&apos;s product page and we&apos;ll read the details from there
                  instead.
                </p>
                <div className="flex gap-2">
                  <Input
                    id="bean-url"
                    type="url"
                    inputMode="url"
                    placeholder="https://roaster.example/coffee"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="flex-1"
                  />
                  <Button type="submit" variant="outline" disabled={url.trim() === ''}>
                    Import
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {preview && stage !== 'idle' && (
          <img
            src={preview}
            alt="The coffee bag you just captured"
            className="max-h-64 rounded-md"
          />
        )}

        {(stage === 'processing' || stage === 'extracting' || stage === 'importing') && (
          <p role="status" className="text-muted-foreground text-sm">
            {stage === 'processing'
              ? 'Preparing your photo…'
              : stage === 'importing'
                ? 'Reading that page…'
                : 'Reading the label…'}
          </p>
        )}

        {stage === 'queued' && (
          <div className="space-y-3">
            <p role="status" className="text-sm">
              Saved. You&apos;re offline, so we&apos;ll read the label automatically once you
              reconnect.
            </p>
            <Button type="button" variant="outline" onClick={reset}>
              Add another
            </Button>
          </div>
        )}

        {stage === 'confirm' && confirmState && (
          <ConfirmForm
            bean={confirmState.bean}
            {...(confirmState.rawText ? { rawText: confirmState.rawText } : {})}
            {...(confirmState.schemaErrors ? { schemaErrors: confirmState.schemaErrors } : {})}
            {...(confirmState.usedMock ? { usedMock: true } : {})}
          />
        )}
      </CardContent>
    </Card>
  );
}
