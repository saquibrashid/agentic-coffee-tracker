import { db } from '@/services/db';
import { mockOcrFromPhotoBlob } from '@/services/mocks/ocrMock';
import { mockParse } from '@/services/mocks/parseMock';
import { ulid } from 'ulid';
import type { PendingAiTask } from '@/types';

let running = false;
let intervalId: number | null = null;

async function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

async function processTask(task: PendingAiTask): Promise<void> {
  try {
    if (task.type === 'ocr') {
      const payload = (task.payload || {}) as { photoId?: string };
      if (!payload.photoId) throw new Error('Missing photoId');
      const photo = await db.photos.get(payload.photoId);
      if (!photo) throw new Error('photo not found');

      const ocr = mockOcrFromPhotoBlob(photo.blob);
      await db.ocrResults.add({
        id: ocr.id,
        photoId: payload.photoId,
        rawText: ocr.rawText,
        provider: 'azure-vision',
        providerVersion: ocr.providerVersion,
        createdAt: ocr.createdAt,
      });

      const next: PendingAiTask = {
        id: ulid(),
        schemaVersion: 1,
        type: 'llm-parse',
        payload: { photoId: payload.photoId, ocrId: ocr.id },
        beanId: task.beanId,
        attempts: 0,
        createdAt: new Date().toISOString(),
      };
      await db.pendingAiTasks.add(next);
    } else if (task.type === 'llm-parse') {
      const payload = (task.payload || {}) as { photoId?: string };
      if (!payload.photoId) throw new Error('Missing photoId');
      const photo = await db.photos.get(payload.photoId);
      if (!photo) throw new Error('photo not found');

      const base64 = await readBlobAsBase64(photo.blob);
      const parsed = mockParse(base64);

      if (task.beanId) {
        const bean = await db.beans.get(task.beanId);
        if (bean) {
          const parsedBean = (parsed.bean || {}) as { name?: string; roaster?: string };
          await db.beans.update(task.beanId, {
            name: parsedBean.name || bean.name,
            roaster: parsedBean.roaster || bean.roaster,
            confidence: parsed.confidence ?? bean.confidence,
            rawOcrText: parsed.rawText ?? bean.rawOcrText,
            needsReview: true,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }

    await db.pendingAiTasks.delete(task.id);
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('QueueRunner task failed', error.message);
    const attempts = (task.attempts || 0) + 1;
    const nextDelay = Math.min(60 * 60 * 1000, 2 ** attempts * 1000);
    const nextAttemptAt = new Date(Date.now() + nextDelay).toISOString();
    await db.pendingAiTasks.update(task.id, {
      attempts,
      lastError: error.message,
      nextAttemptAt,
    });
  }
}

async function drainOnce(): Promise<void> {
  if (!navigator.onLine) return;

  const drain = async () => {
    const tasks = await db.pendingAiTasks.orderBy('nextAttemptAt').toArray();
    for (const t of tasks) {
      if (t.nextAttemptAt && new Date(t.nextAttemptAt) > new Date()) continue;
      await processTask(t);
    }
  };

  if (typeof navigator.locks === 'object' && navigator.locks) {
    try {
      await navigator.locks.request('queue-runner', drain);
    } catch (err) {
      console.error('QueueRunner lock failed', err);
    }
  } else {
    if (running) return;
    running = true;
    try {
      await drain();
    } finally {
      running = false;
    }
  }
}

const onOnline = () => void drainOnce();

export function startQueueRunner(intervalMs = 30_000): void {
  if (intervalId) return;
  void drainOnce();
  window.addEventListener('online', onOnline);
  intervalId = window.setInterval(() => void drainOnce(), intervalMs);
  console.info('QueueRunner started');
}

export function stopQueueRunner(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  window.removeEventListener('online', onOnline);
  console.info('QueueRunner stopped');
}
