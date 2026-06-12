import React, { useState } from 'react';
import { mockParse } from '@/services/mocks/parseMock';
import { resizeDataUrl, createThumbnail, dataUrlToBlob } from '@/services/image/imagePipeline';
import { db } from '@/services/db';
import { ulid } from 'ulid';

interface ParseResult {
  res: unknown;
  photoId: string;
  beanId: string;
  taskId: string;
}

export function CaptureDemo() {
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [loading, setLoading] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);
      setLoading(true);
      try {
        // Resize main image to 1600px and create thumbnail
        const resized = resizeDataUrl(dataUrl, 1600);
        const thumb = createThumbnail(dataUrl, 160);

        // Convert to blobs
        const mainBlob = dataUrlToBlob(resized.dataUrl);
        const thumbBlob = dataUrlToBlob(thumb.dataUrl);

        // Persist to Dexie
        const photoId = ulid();
        await db.photos.add({
          id: photoId,
          schemaVersion: 1,
          kind: 'bag',
          mimeType: mainBlob.type,
          blob: mainBlob,
          widthPx: resized.width,
          heightPx: resized.height,
          byteSize: mainBlob.size,
          createdAt: new Date().toISOString(),
        });

        // Create a draft bean record
        const beanId = ulid();
        const now = new Date().toISOString();
        await db.beans.add({
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
        });

        // Enqueue pending AI task
        const taskId = ulid();
        await db.pendingAiTasks.add({
          id: taskId,
          schemaVersion: 1,
          type: 'ocr',
          payload: { photoId },
          beanId,
          attempts: 0,
          createdAt: now,
        });

        // Call mock parse to show immediate feedback (simulates cloud parse)
        const res = dataUrlToBase64(resized.dataUrl);
        const parseRes = await mockParse(res);

        setResult({ res: parseRes, photoId, beanId, taskId });
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(error.message);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(f);
  }

  function dataUrlToBase64(dataUrl: string): string {
    return dataUrl.split(',')[1] || '';
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">Capture Demo (Mocked Parse)</h2>
      <p className="text-sm text-muted-foreground">Use this page to test the local parse flow without Azure.</p>

      <div className="mt-4">
        <input aria-label="Upload photo" type="file" accept="image/*" onChange={(e) => void onFile(e)} />
      </div>

      {preview && (
        <div className="mt-4">
          <img src={preview} alt="preview" className="max-w-xs rounded" />
        </div>
      )}

      {loading && <p className="mt-4">Processing &amp; parsing…</p>}

      {result && (
        <div className="mt-4">
          <h3 className="font-medium">Parse result</h3>
          <pre className="mt-2 whitespace-pre-wrap rounded bg-muted p-3 text-sm">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
