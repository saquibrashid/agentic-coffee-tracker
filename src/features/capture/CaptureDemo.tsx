import React, { useState } from 'react';
import { mockParse } from '@/services/mocks/parseMock';

export function CaptureDemo() {
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      setPreview(reader.result as string);
      setLoading(true);
      try {
        const res = await mockParse(base64);
        setResult(res);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(f);
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">Capture Demo (Mocked Parse)</h2>
      <p className="text-sm text-muted-foreground">Use this page to test the local parse flow without Azure.</p>

      <div className="mt-4">
        <input aria-label="Upload photo" type="file" accept="image/*" onChange={onFile} />
      </div>

      {preview && (
        <div className="mt-4">
          <img src={preview} alt="preview" className="max-w-xs rounded" />
        </div>
      )}

      {loading && <p className="mt-4">Parsing…</p>}

      {result && (
        <pre className="mt-4 whitespace-pre-wrap rounded bg-muted p-3 text-sm">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}
