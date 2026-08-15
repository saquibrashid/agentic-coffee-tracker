import { useEffect, useState } from 'react';

import { db } from '@/services/db';

export type PhotoSource = { kind: 'stored'; photoId: string } | { kind: 'blob'; blob: Blob };

export function usePhotoObjectUrl(source: PhotoSource | undefined, enabled = true): string | null {
  const [resolved, setResolved] = useState<{
    source: string | Blob;
    url: string;
  } | null>(null);
  const photoId = source?.kind === 'stored' ? source.photoId : undefined;
  const blob = source?.kind === 'blob' ? source.blob : undefined;
  const activeSource = enabled ? (photoId ?? blob ?? null) : null;

  useEffect(() => {
    if (!activeSource) return;

    let active = true;
    let objectUrl: string | null = null;

    const load = async () => {
      const photoBlob = blob ?? (photoId ? (await db.photos.get(photoId))?.blob : undefined);
      if (!photoBlob) {
        if (active) setResolved(null);
        return;
      }
      if (!active) return;

      objectUrl = URL.createObjectURL(photoBlob);
      if (active) setResolved({ source: activeSource, url: objectUrl });
    };

    void load();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeSource, photoId, blob]);

  return resolved?.source === activeSource ? resolved.url : null;
}
