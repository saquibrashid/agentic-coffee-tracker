/**
 * Capture flow: photo -> local persist -> OCR/parse -> confirm (specs/ui.md §2).
 *
 * The bean row is written to IndexedDB *before* any network call, so an offline
 * capture is never lost; the AI work is queued and reconciled by the queue runner.
 */
import { useState, type ChangeEvent } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { db } from '@/services/db';
import { createThumbnail, dataUrlToBlob, resizeDataUrl } from '@/services/image/imagePipeline';
import { extractBeanFromPhoto, PipelineUnavailableError } from '@/services/ai/pipeline';
import { parsedBeanToUpdate } from '@/services/ai/mapping';
import { ConfirmForm } from './ConfirmForm';
import type { CoffeeBean } from '@/types';
import { ulid } from 'ulid';

type Stage = 'idle' | 'processing' | 'extracting' | 'confirm' | 'queued';

interface ConfirmState {
  bean: CoffeeBean;
  rawText?: string;
  schemaErrors?: string[];
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

  function reset() {
    setStage('idle');
    setPreview(null);
    setConfirmState(null);
    setError(null);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setStage('processing');

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPreview(dataUrl);

      const [resized, thumb] = await Promise.all([
        resizeDataUrl(dataUrl, 1600),
        createThumbnail(dataUrl, 160),
      ]);
      const blob = await dataUrlToBlob(resized.dataUrl);

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

        const bean = await db.beans.get(beanId);
        setConfirmState({
          bean: bean ?? { ...draft, ...update },
          rawText: result.rawText,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong reading that photo.');
      setStage('idle');
    }
  }

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
            <label htmlFor="bag-photo" className="mb-2 block text-sm font-medium">
              Photo of the coffee bag
            </label>
            <input
              id="bag-photo"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void handleFile(e)}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
            />
            {error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        )}

        {preview && stage !== 'idle' && (
          <img
            src={preview}
            alt="The coffee bag you just captured"
            className="max-h-64 rounded-md"
          />
        )}

        {(stage === 'processing' || stage === 'extracting') && (
          <p role="status" className="text-sm text-muted-foreground">
            {stage === 'processing' ? 'Preparing your photo…' : 'Reading the label…'}
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
          />
        )}
      </CardContent>
    </Card>
  );
}
