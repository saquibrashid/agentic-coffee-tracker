/**
 * Drains `pendingAiTasks` — the offline-first reconciliation loop.
 *
 * Captures made while offline (or while the BFF is down) leave a task behind.
 * This runner retries them with exponential backoff whenever the browser is
 * online, applying the extracted metadata to the bean and leaving
 * `needsReview = true` so the user still gets the final say.
 */
import { db } from '@/services/db';
import { extractBeanFromPhoto, PipelineUnavailableError } from '@/services/ai/pipeline';
import { parsedBeanToUpdate } from '@/services/ai/mapping';
import type { CoffeeBean, PendingAiTask } from '@/types';

const MAX_BACKOFF_MS = 60 * 60 * 1000;

let running = false;
let intervalId: number | null = null;

interface PhotoPayload {
  photoId?: string;
}

async function processTask(task: PendingAiTask): Promise<void> {
  // 'ocr' and 'llm-parse' are handled identically: the pipeline runs OCR and
  // parse together, so a legacy 'llm-parse' task simply re-runs both.
  if (task.type !== 'ocr' && task.type !== 'llm-parse') {
    await db.pendingAiTasks.delete(task.id);
    return;
  }

  const payload = (task.payload ?? {}) as PhotoPayload;
  if (!payload.photoId) throw new Error('Task is missing photoId');

  const photo = await db.photos.get(payload.photoId);
  if (!photo) throw new Error(`Photo ${payload.photoId} no longer exists`);

  const result = await extractBeanFromPhoto(photo.blob);

  if (task.beanId) {
    const bean = await db.beans.get(task.beanId);
    if (bean) {
      const update: Partial<CoffeeBean> = {
        rawOcrText: result.rawText,
        // The user has not seen this yet, so it always needs confirmation.
        needsReview: true,
        updatedAt: new Date().toISOString(),
        ...(result.parsed ? parsedBeanToUpdate(result.parsed) : {}),
      };
      if (result.model) update.llmModel = result.model;
      await db.beans.update(task.beanId, update);
    }
  }

  await db.pendingAiTasks.delete(task.id);
}

async function handleFailure(task: PendingAiTask, err: unknown): Promise<void> {
  const error = err instanceof Error ? err : new Error(String(err));
  const attempts = (task.attempts || 0) + 1;
  const nextDelay = Math.min(MAX_BACKOFF_MS, 2 ** attempts * 1000);
  await db.pendingAiTasks.update(task.id, {
    attempts,
    lastError: error.message,
    nextAttemptAt: new Date(Date.now() + nextDelay).toISOString(),
  });
}

async function drain(): Promise<void> {
  const tasks = await db.pendingAiTasks.toArray();
  const now = Date.now();

  for (const task of tasks) {
    if (task.nextAttemptAt && new Date(task.nextAttemptAt).getTime() > now) continue;
    try {
      await processTask(task);
    } catch (err) {
      // Backend still unreachable is expected offline: back off without noise.
      if (!(err instanceof PipelineUnavailableError)) {
        console.error('QueueRunner task failed', err);
      }
      await handleFailure(task, err);
    }
  }
}

async function drainOnce(): Promise<void> {
  if (!navigator.onLine) return;

  // Web Locks keeps multiple tabs from racing on the same tasks.
  if (typeof navigator.locks === 'object' && navigator.locks) {
    try {
      await navigator.locks.request('queue-runner', drain);
    } catch (err) {
      console.error('QueueRunner lock failed', err);
    }
    return;
  }

  if (running) return;
  running = true;
  try {
    await drain();
  } finally {
    running = false;
  }
}

const onOnline = () => void drainOnce();

/** Runs a drain now, on every `online` event, and on an interval. Idempotent. */
export function startQueueRunner(intervalMs = 30_000): void {
  if (intervalId) return;
  void drainOnce();
  window.addEventListener('online', onOnline);
  intervalId = window.setInterval(() => void drainOnce(), intervalMs);
}

export function stopQueueRunner(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  window.removeEventListener('online', onOnline);
}

/** Exposed for the Settings screen's "Run queue now" action. */
export const runQueueNow = drainOnce;
