import { db } from '@/services/db';
import { mockOcrFromPhotoBlob } from '@/services/mocks/ocrMock';
import { mockParse } from '@/services/mocks/parseMock';
import { ulid } from 'ulid';

let running = false;
let intervalId: number | null = null;

interface QueueTask {
  id: string;
  type: 'ocr' | 'llm-parse';
  payload: Record<string, unknown>;
  beanId?: string;
  attempts?: number;
  nextAttemptAt?: string;
  [key: string]: unknown;
}

async function processTask(task: QueueTask) {
  const now = new Date().toISOString();
  try {
    if (task.type === 'ocr') {
      const { photoId } = task.payload as { photoId?: string };
      const photo = await db.photos.get(photoId as string);
      if (!photo) throw new Error('photo not found');

      // Read blob and call mock OCR
      const ocr = await mockOcrFromPhotoBlob(photo.blob as Blob);
      await db.ocrResults.add({
        id: ocr.id,
        photoId,
        rawText: ocr.rawText,
        provider: ocr.provider,
        providerVersion: ocr.providerVersion,
        createdAt: ocr.createdAt,
      });

      // enqueue llm-parse task
      const parseTask: QueueTask = {
        id: ulid(),
        schemaVersion: 1,
        type: 'llm-parse',
        payload: { photoId, ocrId: ocr.id },
        beanId: task.beanId,
        attempts: 0,
        createdAt: now,
      };
      await db.pendingAiTasks.add(parseTask);
    } else if (task.type === 'llm-parse') {
      const { photoId } = task.payload as { photoId?: string };
      // For mock, call mockParse with base64 of photo blob
      const photo = await db.photos.get(photoId as string);
      if (!photo) throw new Error('photo not found');

      // Convert blob to base64
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
        reader.onerror = () => reject(new Error('Failed to read blob'));
        reader.readAsDataURL(photo.blob as Blob);
      });

      const parsed = await mockParse(base64);

      // Update bean with parsed fields
      if (task.beanId) {
        const bean = await db.beans.get(task.beanId as string);
        if (bean) {
          const parsedBean = parsed.bean as Record<string, unknown> | undefined;
          await db.beans.update(task.beanId as string, {
            name: (parsedBean?.name as string) || bean.name,
            roaster: (parsedBean?.roaster as string) || bean.roaster,
            origin: (parsedBean?.origin as string) || (bean as Record<string, unknown>).origin,
            confidence: (parsed.confidence as number) ?? bean.confidence,
            rawOcrText: (parsed.rawText as string) ?? bean.rawOcrText,
            needsReview: true,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      // Optionally store more structured outputs (not implemented)
    }

    // task processed — remove it
    await db.pendingAiTasks.delete(task.id);
  } catch (err) {
    const error = err as Error;
    console.error('QueueRunner task failed', err);
    // update task attempts and lastError/backoff
    const attempts = (task.attempts || 0) + 1;
    const nextDelay = Math.min(60 * 60 * 1000, 2 ** attempts * 1000); // exponential backoff up to 1 hour
    const nextAttemptAt = new Date(Date.now() + nextDelay).toISOString();
    await db.pendingAiTasks.update(task.id, {
      attempts,
      lastError: String(error?.message || err),
      nextAttemptAt,
    } as unknown);
  }
}

async function drainOnce() {
  if (!navigator.onLine) return;
  if (typeof navigator.locks === 'object' && navigator.locks) {
    try {
      await navigator.locks.request('queue-runner', async () => {
        const tasks = await db.pendingAiTasks.orderBy('nextAttemptAt').toArray();
        for (const t of tasks) {
          // skip scheduled tasks
          if (t.nextAttemptAt && new Date(t.nextAttemptAt) > new Date()) continue;
          await processTask(t as QueueTask);
        }
      });
    } catch (err) {
      console.error('QueueRunner lock failed', err);
    }
  } else {
    // Fallback: simple mutex via in-memory flag
    if (running) return;
    running = true;
    try {
      const tasks = await db.pendingAiTasks.orderBy('nextAttemptAt').toArray();
      for (const t of tasks) {
        if (t.nextAttemptAt && new Date(t.nextAttemptAt) > new Date()) continue;
        await processTask(t as QueueTask);
      }
    } finally {
      running = false;
    }
  }
}

export function startQueueRunner(intervalMs = 30_000) {
  if (intervalId) return;
  // Drain immediately and then on interval
  void drainOnce().catch((e) => console.error(e));
  window.addEventListener('online', () => void drainOnce());
  intervalId = window.setInterval(() => void drainOnce(), intervalMs);
  console.info('QueueRunner started');
}

export function stopQueueRunner() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  window.removeEventListener('online', () => void drainOnce());
  console.info('QueueRunner stopped');
}
