import { db } from '@/services/db';
import type { CoffeeBean, LookupOutcome } from '@/types';

/**
 * Durable record of what web lookups did.
 *
 * The queue used to delete an enrichment task the same way whatever happened to
 * it — filled, found nothing, gave up permanently — so pressing "Look up
 * missing details" produced a count that did not move and no explanation
 * anywhere for why (#246). The only status message lived in component state and
 * was destroyed by navigating away.
 *
 * Outcomes are written onto the coffee rather than into a run log because the
 * question the user is actually asking is per-coffee: *this* one is still
 * incomplete — was it tried, and what happened? A run log would answer it only
 * for the most recent run and would have to be joined back to the coffees
 * anyway. The run marker below exists purely to scope the Settings summary to
 * "what the button you just pressed did".
 */

/** `meta` key holding the ISO timestamp of the last relookup run. */
export const LAST_RELOOKUP_KEY = 'lastRelookupStartedAt';

/**
 * `meta` key holding how many coffees that run expected to hear back about.
 *
 * Counted as *incomplete* coffees rather than newly queued tasks: a coffee
 * whose lookup was already sitting in the queue still reports during this run,
 * so leaving it out would make the summary permanently short by that many.
 */
export const LAST_RELOOKUP_QUEUED_KEY = 'lastRelookupQueued';

/**
 * Writes the outcome without touching `updatedAt`.
 *
 * Deliberate: `updatedAt` drives sync and the library's sort order, and a
 * lookup that found nothing has not changed the coffee in any way the user
 * would recognise. Bumping it would reshuffle the library after a run that
 * changed nothing. When a lookup *does* fill fields, the enrich update carries
 * its own `updatedAt` and syncs normally.
 */
export async function recordLookupOutcome(
  beanId: string,
  outcome: LookupOutcome,
  now = new Date().toISOString(),
): Promise<void> {
  await db.beans.update(beanId, { lastLookupAt: now, lastLookupOutcome: outcome });
}

export async function markRelookupStarted(now = new Date().toISOString()): Promise<void> {
  await db.meta.put({ key: LAST_RELOOKUP_KEY, value: now });
}

export async function lastRelookupStartedAt(): Promise<string | null> {
  const record = await db.meta.get(LAST_RELOOKUP_KEY);
  return typeof record?.value === 'string' ? record.value : null;
}

export interface LookupTally {
  filled: number;
  nothingNew: number;
  notFound: number;
  failed: number;
  /** Coffees queued by the run that have not reported an outcome yet. */
  pending: number;
}

export function emptyTally(pending = 0): LookupTally {
  return { filled: 0, nothingNew: 0, notFound: 0, failed: 0, pending };
}

/**
 * Tallies outcomes recorded at or after `since`.
 *
 * `pending` is derived by subtraction rather than by counting queue rows, so it
 * stays right even if a task is cancelled from the queue panel: anything queued
 * that never reported is still, from the user's point of view, unfinished.
 */
export function tallyLookups(
  beans: CoffeeBean[],
  since: string | null,
  queued: number,
): LookupTally {
  const tally = emptyTally();
  if (!since) return tally;

  for (const bean of beans) {
    if (!bean.lastLookupAt || bean.lastLookupAt < since) continue;
    switch (bean.lastLookupOutcome) {
      case 'filled':
        tally.filled += 1;
        break;
      case 'nothing-new':
        tally.nothingNew += 1;
        break;
      case 'not-found':
        tally.notFound += 1;
        break;
      case 'failed':
        tally.failed += 1;
        break;
    }
  }

  const reported = tally.filled + tally.nothingNew + tally.notFound + tally.failed;
  tally.pending = Math.max(0, queued - reported);
  return tally;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Turns a tally into a sentence.
 *
 * Every non-zero outcome is named, including the discouraging ones. The whole
 * point of #246 was that a run which changed nothing looked identical to one
 * that was never pressed, so "found nothing" has to be said out loud — and
 * `not-found` has to say that retrying will not help, because the queue will
 * not retry it and the user would otherwise sit pressing the button.
 */
export function describeTally(tally: LookupTally): string | null {
  const parts: string[] = [];
  if (tally.filled > 0) parts.push(`filled in ${plural(tally.filled, 'coffee', 'coffees')}`);
  if (tally.nothingNew > 0) {
    parts.push(`found nothing new for ${plural(tally.nothingNew, 'coffee', 'coffees')}`);
  }
  if (tally.notFound > 0) {
    parts.push(`found no product page for ${plural(tally.notFound, 'coffee', 'coffees')}`);
  }
  if (tally.failed > 0) parts.push(`failed on ${plural(tally.failed, 'coffee', 'coffees')}`);

  if (parts.length === 0) {
    return tally.pending > 0
      ? `${plural(tally.pending, 'lookup is', 'lookups are')} still running.`
      : null;
  }

  const sentence = `The last run ${joinParts(parts)}.`;
  const tail: string[] = [];
  if (tally.pending > 0)
    tail.push(`${plural(tally.pending, 'lookup is', 'lookups are')} still running.`);
  if (tally.notFound > 0) {
    tail.push(
      'A coffee with no product page is usually one whose name was shortened on import — editing the name and trying again is what fixes it.',
    );
  }
  return [sentence, ...tail].join(' ');
}

function joinParts(parts: string[]): string {
  const last = parts[parts.length - 1] ?? '';
  if (parts.length === 1) return last;
  return `${parts.slice(0, -1).join(', ')} and ${last}`;
}
