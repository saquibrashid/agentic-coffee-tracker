import { db } from '@/services/db';
import { enqueueUpsert } from '@/services/sync/outbox';
import { inferRoastLevel } from './inferRoast';
import type { CoffeeBean } from '@/types';

/**
 * Fills in roast levels that are already inferable from text a bean is
 * carrying.
 *
 * Auto-enrichment covers this too, but only by way of a network lookup and an
 * LLM parse per bean. A library imported from a ratings export can be hundreds
 * of rows deep and lands almost entirely as `unknown`, which is exactly the
 * state that makes the preference profile useless. Inference is pure string
 * matching over data we already hold, so there is no reason to make the user
 * wait on the network for the subset it can resolve offline.
 *
 * Deliberately *not* a Dexie migration. A migration would have to bump
 * `updatedAt` and write outbox rows from inside an upgrade transaction to sync
 * correctly, which is fragile, and it would only ever run once — beans arriving
 * later from another device would never be revisited.
 */

/** A bean is a candidate while it has no usable roast level. */
function needsRoast(bean: CoffeeBean): boolean {
  return !bean.roastLevel || bean.roastLevel === 'unknown';
}

export interface RoastBackfillResult {
  /** Beans that had no usable roast level when the pass started. */
  considered: number;
  /** Beans whose roast level this pass resolved and wrote. */
  filled: number;
}

/**
 * Runs one inference pass over every bean missing a roast level.
 *
 * Safe to call on every app start: a bean that gets filled no longer matches,
 * and one that cannot be resolved costs only a few regex tests. That
 * self-limiting behaviour is why there is no "already ran" flag to get out of
 * step with reality.
 *
 * Only ever writes into a gap, so a roast the user set by hand is untouchable.
 */
export async function backfillRoastLevels(): Promise<RoastBackfillResult> {
  const candidates = (await db.beans.toArray()).filter(needsRoast);
  let filled = 0;

  for (const bean of candidates) {
    const inference = inferRoastLevel({
      name: bean.name,
      roasterDescription: bean.roasterDescription,
      tastingNotes: bean.tastingNotes,
    });
    if (!inference) continue;

    await db.beans.update(bean.id, {
      roastLevel: inference.level,
      updatedAt: new Date().toISOString(),
    });
    await enqueueUpsert('bean', bean.id);
    filled += 1;
  }

  return { considered: candidates.length, filled };
}
