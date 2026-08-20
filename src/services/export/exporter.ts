import { db } from '@/services/db';
import type { CoffeeBean, Rating } from '@/types';

/**
 * Sample coffees are loaded into the real tables so Analytics and "For you" can
 * be seen working before there is any history (#241) — but an export is a
 * backup of what the user actually drank, so they are stripped here. These
 * three functions are the only places records are gathered for export, which is
 * what makes one filter sufficient.
 */
async function realRecords(): Promise<{ beans: CoffeeBean[]; ratings: Rating[] }> {
  const [beans, ratings] = await Promise.all([
    db.beans.filter((b) => b.isSample !== true).toArray(),
    db.ratings.filter((r) => r.isSample !== true).toArray(),
  ]);
  return { beans, ratings };
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      Object.keys(r).forEach((k) => acc.add(k));
      return acc;
    }, new Set()),
  );
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const headerLine = headers.join(',');
  const lines = rows.map((r) => headers.map((h) => escape(r[h])).join(','));
  return [headerLine, ...lines].join('\n');
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportJson(): Promise<void> {
  const { beans, ratings } = await realRecords();
  const payload = { exportedAt: new Date().toISOString(), beans, ratings };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `coffee-export-${Date.now()}.json`);
}

export async function exportCsv(): Promise<void> {
  const { beans, ratings } = await realRecords();
  const beansCsv = toCsv(beans as unknown as Record<string, unknown>[]);
  const ratingsCsv = toCsv(ratings as unknown as Record<string, unknown>[]);
  const combined = `# beans\n${beansCsv}\n\n# ratings\n${ratingsCsv}\n`;
  const blob = new Blob([combined], { type: 'text/csv' });
  triggerDownload(blob, `coffee-export-${Date.now()}.csv`);
}

export async function exportJsonWithPhotos(): Promise<void> {
  // Embed photos as base64 inside JSON for a single-file portable export.
  const { beans, ratings } = await realRecords();
  const photos = await db.photos.toArray();
  const photosEncoded = await Promise.all(
    photos.map(async (p) => {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read photo blob'));
        reader.readAsDataURL(p.blob);
      });
      return { ...p, blob: undefined, dataUrl };
    }),
  );
  const payload = { exportedAt: new Date().toISOString(), beans, ratings, photos: photosEncoded };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  triggerDownload(blob, `coffee-export-with-photos-${Date.now()}.json`);
}
