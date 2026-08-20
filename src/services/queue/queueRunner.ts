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
import {
  autoEnrichBean,
  isNotFoundFailure,
  isTerminalEnrichFailure,
} from '@/services/enrich/autoEnrich';
import { recordLookupOutcome } from '@/services/enrich/lookupOutcome';
import {
  applyStudioPhoto,
  isTerminalStudioFailure,
  prepareStudioPhoto,
  sourcePhotoFor,
} from '@/services/enrich/studioPhoto';
import { enqueueUpsert } from '@/services/sync/outbox';
import type { CoffeeBean, PendingAiTask } from '@/types';

const MAX_BACKOFF_MS = 60 * 60 * 1000;

/**
 * Web-enrich tasks per drain. A bulk import can queue one per coffee, and each
 * costs a search + a scrape + a model call, so draining them all at once would
 * fire hundreds of billable requests in a burst. Capping spreads the work over
 * successive intervals instead; the queue is durable, so nothing is lost.
 */
const MAX_ENRICH_PER_DRAIN = 3;

/**
 * Studio re-shoots per drain, deliberately lower than enrichment's budget.
 *
 * A web lookup costs fractions of a cent; a generated image costs real money and
 * takes the better part of a minute. One per drain re-shoots a library at two an
 * hour on the default interval — slow enough that a bulk run stays a background
 * job the user can watch and cancel from Settings, rather than a bill that
 * arrives before they notice.
 */
const MAX_STUDIO_PER_DRAIN = 1;

let running = false;
let intervalId: number | null = null;

interface PhotoPayload {
  photoId?: string;
}

async function processTask(task: PendingAiTask): Promise<void> {
  if (task.type === 'web-enrich') {
    await processEnrichTask(task);
    return;
  }

  if (task.type === 'studio-photo') {
    await processStudioPhotoTask(task);
    return;
  }

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
  // A model that redraws packaging can invent text, and details parsed off an
  // invented label would be indistinguishable from real ones. Reading the
  // photograph a studio shot was generated from is both safe and what the task
  // meant; a generated image with no surviving original is nothing to read at
  // all, and the task is dropped rather than retried.
  const source = await sourcePhotoFor(photo.id);
  if (!source) {
    console.warn('QueueRunner dropping extraction for a generated photo', photo.id);
    await db.pendingAiTasks.delete(task.id);
    return;
  }

  const result = await extractBeanFromPhoto(source.blob);

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
      // Unlike the other mapped fields this one may be inferred rather than
      // read off the bag, and a guess from a name is weaker evidence than a
      // level the user picked. Only a roast the model actually resolved is
      // allowed to replace an existing one.
      if (
        bean.roastLevel &&
        bean.roastLevel !== 'unknown' &&
        !result.parsed?.roastLevel &&
        update.roastLevel
      ) {
        delete update.roastLevel;
      }
      if (result.model) update.llmModel = result.model;
      await db.beans.update(task.beanId, update);
      await enqueueUpsert('bean', task.beanId);
    }
  }

  await db.pendingAiTasks.delete(task.id);
}

/**
 * Backfills a coffee's missing metadata from the web. Unlike the photo tasks,
 * this never sets `needsReview`: it only ever fills gaps, so there is nothing
 * the user needs to arbitrate, and flagging a whole bulk import for review would
 * make the flag meaningless.
 */
async function processEnrichTask(task: PendingAiTask): Promise<void> {
  if (!task.beanId) {
    await db.pendingAiTasks.delete(task.id);
    return;
  }

  const bean = await db.beans.get(task.beanId);
  // The coffee was deleted while the task waited. Nothing left to enrich.
  if (!bean) {
    await db.pendingAiTasks.delete(task.id);
    return;
  }

  const result = await autoEnrichBean(bean);
  if (result) {
    await db.beans.update(bean.id, result.update);
    await enqueueUpsert('bean', bean.id);
  }
  // Recorded either way (#246). A lookup that found nothing used to be
  // indistinguishable from one that never ran, which is why the Settings count
  // appeared frozen after a run.
  await recordLookupOutcome(bean.id, result ? 'filled' : 'nothing-new');
  await db.pendingAiTasks.delete(task.id);
}

/**
 * Re-shoots one coffee's bag photo as a studio product shot.
 *
 * Applied rather than offered, which is the one place this differs from the
 * per-coffee flow. A bulk re-shoot is a thing someone explicitly asked for over
 * a whole library, and stacking up dozens of decisions to make later would be a
 * worse answer than applying them and leaving each one revertible — the original
 * photograph is kept either way, so nothing here is destructive.
 */
async function processStudioPhotoTask(task: PendingAiTask): Promise<void> {
  if (!task.beanId) {
    await db.pendingAiTasks.delete(task.id);
    return;
  }

  const bean = await db.beans.get(task.beanId);
  // The coffee was deleted while the task waited, or lost its photo since.
  if (!bean || !bean.photoId) {
    await db.pendingAiTasks.delete(task.id);
    return;
  }

  const candidate = await prepareStudioPhoto(bean);
  await applyStudioPhoto(bean, candidate);
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
  let enrichBudget = MAX_ENRICH_PER_DRAIN;
  let studioBudget = MAX_STUDIO_PER_DRAIN;

  for (const task of tasks) {
    if (task.nextAttemptAt && new Date(task.nextAttemptAt).getTime() > now) continue;
    if (task.type === 'web-enrich') {
      if (enrichBudget <= 0) continue;
      enrichBudget -= 1;
    }
    if (task.type === 'studio-photo') {
      if (studioBudget <= 0) continue;
      studioBudget -= 1;
    }
    try {
      await processTask(task);
    } catch (err) {
      // A lookup that failed deterministically (no product page, dead link, bad
      // request) will fail identically forever. Drop it rather than let it retry
      // for an hour at a time — the coffee simply keeps whatever it was imported
      // with, which is exactly the pre-enrichment state.
      if (task.type === 'web-enrich' && isTerminalEnrichFailure(err)) {
        console.warn('QueueRunner dropping unenrichable task', task.beanId, err);
        // The user is owed the reason, since nothing will ever retry this on
        // its own (#246). "No product page" is separated from a generic
        // failure because only the former is worth editing the name over.
        if (task.beanId) {
          await recordLookupOutcome(task.beanId, isNotFoundFailure(err) ? 'not-found' : 'failed');
        }
        await db.pendingAiTasks.delete(task.id);
        continue;
      }
      // Same reasoning, and more urgent: a refused re-shoot that retried hourly
      // would be a request the model declines every time, and each attempt that
      // did get through would be billed.
      if (task.type === 'studio-photo' && isTerminalStudioFailure(err)) {
        console.warn('QueueRunner dropping unshootable task', task.beanId, err);
        await db.pendingAiTasks.delete(task.id);
        continue;
      }
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
