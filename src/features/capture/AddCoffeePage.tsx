import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useState } from 'react';
import { resizeDataUrl, createThumbnail, dataUrlToBlob } from '@/services/image/imagePipeline';
import { db } from '@/services/db';
import { ulid } from 'ulid';
import { ocr, parse } from '@/services/ai';
import { ConfirmForm } from '@/features/capture/ConfirmForm';

export function AddCoffeePage() {
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [beanId, setBeanId] = useState<string | null>(null);
  const [parsed, setParsed] = useState<any | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);
      setLoading(true);
      try {
        const resized = await resizeDataUrl(dataUrl, 1600);
        const thumb = await createThumbnail(dataUrl, 160);
        const mainBlob = await dataUrlToBlob(resized.dataUrl);
        const photoId = ulid();
        const now = new Date().toISOString();
        await db.photos.add({
          id: photoId,
          schemaVersion: 1,
          kind: 'bag',
          mimeType: mainBlob.type,
          blob: mainBlob,
          widthPx: resized.width,
          heightPx: resized.height,
          byteSize: mainBlob.size,
          createdAt: now,
        } as any);

        const bId = ulid();
        await db.beans.add({
          id: bId,
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
        } as any);

        setBeanId(bId);

        // If online, call OCR and parse to show immediate results
        if (navigator.onLine) {
          const o = await ocr({ imageBase64: resized.dataUrl.split(',')[1] || '', mimeType: mainBlob.type });
          const p = await parse({ ocrText: o.rawText });
          setParsed(p.parsed || p);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(f);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a coffee</CardTitle>
        <CardDescription>Camera capture and AI extraction land here.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <input aria-label="Upload photo" type="file" accept="image/*" onChange={onFile} />
          </div>

          {preview && (
            <div>
              <img src={preview} alt="preview" className="max-w-xs rounded" />
            </div>
          )}

          {loading && <p>Processing…</p>}

          {beanId && parsed && (
            <div>
              <h3 className="text-sm font-medium">Parsed result — confirm / edit</h3>
              <ConfirmForm beanId={beanId} initial={parsed.bean || parsed} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
