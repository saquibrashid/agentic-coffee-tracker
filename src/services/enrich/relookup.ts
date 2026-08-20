import { ulid } from 'ulid';

import { db } from '@/services/db';
import { beanNeedsEnrichment } from './autoEnrich';
import { LAST_RELOOKUP_QUEUED_KEY, markRelookupStarted } from './lookupOutcome';

/**
 * Re-queues a web lookup for every coffee still missing details.
 *
 * A lookup that finds no product page is treated as terminal — the queue drops
 * the task rather than retrying it hourly forever, because the same search
 * would fail the same way. That is right at the time, but it means a coffee
 * that failed under an older, worse search is stranded: nothing will ever try
 * it again, however much the search improves.
 *
 * Which is exactly what happened. Store search demands that every word of a
 * query match, so an abbreviated name like "Holler Mtn." returned nothing at
 * all, and a whole import's worth of coffees were written off. Now that the
 * search relaxes and retries, those coffees deserve a second look — and the
 * user should not have to open each one and press a button.
 */
export interface RelookupResult {
  /** Coffees still missing something a lookup could fill. */
  incomplete: number;
  /** Lookups actually queued — incomplete coffees minus those already queued. */
  queued: number;
  /** When this run started. Scopes the outcome summary to what this press did. */
  startedAt: string;
}

export async function relookupIncompleteBeans(): Promise<RelookupResult> {
  const beans = await db.beans.toArray();
  const incomplete = beans.filter((bean) => !bean.isArchived && beanNeedsEnrichment(bean));

  const queuedTasks = await db.pendingAiTasks.where('type').equals('web-enrich').toArray();
  const alreadyQueued = new Set(queuedTasks.map((task) => task.beanId));

  const now = new Date().toISOString();
  const tasks = incomplete
    .filter((bean) => !alreadyQueued.has(bean.id))
    .map((bean) => ({
      id: ulid(),
      schemaVersion: 1 as const,
      type: 'web-enrich' as const,
      payload: { reason: 'relookup' },
      beanId: bean.id,
      attempts: 0,
      createdAt: now,
    }));

  if (tasks.length > 0) await db.pendingAiTasks.bulkAdd(tasks);

  // Written before the queue drains so no outcome can land ahead of the marker
  // and be excluded from the summary the user is about to read.
  await markRelookupStarted(now);
  await db.meta.put({ key: LAST_RELOOKUP_QUEUED_KEY, value: incomplete.length });

  return { incomplete: incomplete.length, queued: tasks.length, startedAt: now };
}
