import { db } from '@/services/db';
import { enqueueUpsert } from '@/services/sync/outbox';

/**
 * Clearing the "needs review" flag.
 *
 * Several paths raise `needsReview`: a photo parsed by the AI, a queued
 * backfill, and every accepted web-enrichment proposal (`enrich/diff.ts`).
 * Until now only the capture flow's confirm step ever lowered it again, so a
 * coffee that arrived by import and was later enriched kept the badge for good
 * — the library said "Needs review" and the coffee's own page offered no way to
 * answer it.
 *
 * Reviewing is an assertion by the user that the values are right, so it is its
 * own action rather than a side effect of editing something else: a coffee
 * whose details are already correct needs confirming without any edit at all.
 */
export async function markBeanReviewed(beanId: string): Promise<void> {
  const bean = await db.beans.get(beanId);
  // Nothing to do, and importantly no write: stamping `updatedAt` here would
  // send a pointless revision to every other device on the next sync.
  if (!bean?.needsReview) return;

  await db.beans.update(beanId, { needsReview: false, updatedAt: new Date().toISOString() });
  await enqueueUpsert('bean', beanId);
}
