import { DEFAULT_CAFFEINE } from '@/services/beans/caffeine';
import { db } from '@/services/db';
import { enqueueUpsert } from '@/services/sync/outbox';
import { inferCaffeine } from './inferCaffeine';
import type { CoffeeBean } from '@/types';

/**
 * Gives every coffee recorded before the caffeine field existed a value.
 *
 * The field shipped with no backfill on the argument that absence is not an
 * answer. That was the wrong trade for a library that already exists: it left
 * every coffee the user had ever rated sitting in `unknown`, which is not a
 * neutral state but a permanent exclusion from the one distinction the field
 * was added to draw. The user knows their own shelf — nearly all of it is
 * caffeinated — and "unknown" was recording ignorance the app did not actually
 * have.
 *
 * So the pass reads the name first and falls back to the assumption. A bag
 * called "Night Light Decaf" is decaf on the evidence; everything else becomes
 * caffeinated on the prior. Being wrong about a rare unmarked decaf costs one
 * correction on the bean's own page; being `unknown` about the whole library
 * costs the feature.
 *
 * Deliberately *not* a Dexie migration, for the reasons set out in
 * `backfillRoast.ts`: a migration cannot safely bump `updatedAt` or write
 * outbox rows from an upgrade transaction, and would never revisit a bean that
 * arrives later from another device still running an older build.
 */

/** A bean is a candidate while nothing has answered for it. */
function needsCaffeine(bean: CoffeeBean): boolean {
  return !bean.caffeine || bean.caffeine === 'unknown';
}

export interface CaffeineBackfillResult {
  /** Beans with no caffeine value when the pass started. */
  considered: number;
  /** Beans this pass resolved from their own text. */
  inferred: number;
  /** Beans this pass assumed caffeinated for want of any evidence. */
  assumed: number;
}

/**
 * Runs one pass over every bean with no caffeine value.
 *
 * Safe to call on every app start: a bean it fills stops matching, so repeated
 * runs converge and there is no "already ran" flag that can fall out of step
 * with the data.
 *
 * Only ever writes into a gap. A value the user set by hand — including a decaf
 * they corrected after this pass assumed otherwise — is never revisited, which
 * is what makes running it on every start safe rather than merely idempotent.
 */
export async function backfillCaffeine(): Promise<CaffeineBackfillResult> {
  const candidates = (await db.beans.toArray()).filter(needsCaffeine);
  let inferred = 0;
  let assumed = 0;

  for (const bean of candidates) {
    const inference = inferCaffeine({
      name: bean.name,
      roasterDescription: bean.roasterDescription,
    });
    if (inference) inferred += 1;
    else assumed += 1;

    await db.beans.update(bean.id, {
      caffeine: inference?.level ?? DEFAULT_CAFFEINE,
      updatedAt: new Date().toISOString(),
    });
    await enqueueUpsert('bean', bean.id);
  }

  return { considered: candidates.length, inferred, assumed };
}
