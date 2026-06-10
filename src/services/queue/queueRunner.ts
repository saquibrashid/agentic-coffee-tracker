import { db } from '@/services/db';
import { mockOcrFromPhotoBlob } from '@/services/mocks/ocrMock';
import { mockParse } from '@/services/mocks/parseMock';
import { ulid } from 'ulid';

let running = false;
let intervalId: number | null = null;

async function processTask(task: any) {
  const now = new Date().toISOString();
  try {
    if (task.type === 'ocr') {
      const { photoId, beanId } = task.payload || {};
      const photo = await db.photos.get(photoId);
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
      const parseTask = {
        id: ulid(),
        schemaVersion: 1,
        type: 'llm-parse',
        payload: { photoId, ocrId: ocr.id },
        beanId,
        attempts: 0,
        createdAt: now,
      };
      await db.pendingAiTasks.add(parseTask as any);
    } else if (task.type === 'llm-parse') {
      const { photoId, ocrId } = task.payload || {};
      // For mock, call mockParse with base64 of photo blob
      const photo = await db.photos.get(photoId);
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
        const bean = await db.beans.get(task.beanId);
        if (bean) {
          await db.beans.update(task.beanId, {
            name: parsed.bean?.name || bean.name,
            roaster: parsed.bean?.roaster || bean.roaster,
            origin: parsed.bean?.origin || (bean as any).origin,
            confidence: parsed.confidence ?? bean.confidence,
            rawOcrText: parsed.rawText ?? bean.rawOcrText,
            needsReview: true,
            updatedAt: new Date().toISOString(),
          } as any);
        }
      }

      // Optionally store more structured outputs (not implemented)
    }

    // task processed — remove it
    await db.pendingAiTasks.delete(task.id);
  } catch (err: any) {
    console.error('QueueRunner task failed', err);
    // update task attempts and lastError/backoff
    const attempts = (task.attempts || 0) + 1;
    const nextDelay = Math.min(60 * 60 * 1000, 2 ** attempts * 1000); // exponential backoff up to 1 hour
    const nextAttemptAt = new Date(Date.now() + nextDelay).toISOString();
    await db.pendingAiTasks.update(task.id, {
      attempts,
      lastError: String(err?.message || err),
      nextAttemptAt,
    } as any);
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
          await processTask(t);
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
        await processTask(t);
      }
    } finally {
      running = false;
    }
  }
}

export function startQueueRunner(intervalMs = 30_000) {
  if (intervalId) return;
  // Drain immediately and then on interval
  drainOnce().catch((e) => console.error(e));
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
