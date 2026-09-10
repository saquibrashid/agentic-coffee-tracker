import { db } from '@/services/db';
import { inferComposition } from './inferComposition';
import type { CoffeeBean } from '@/types';

/**
 * Gives coffees recorded before the composition field existed a value.
 *
 * #312 added the field and taught every capture path to fill it, which does
 * nothing for a library that already exists. Enrichment does not close the gap
 * either: `beanNeedsEnrichment` tests `CORE_FIELDS`, and composition is
 * deliberately not core, so a coffee whose core fields are complete is never
 * looked up again. The blends that prompted the whole feature are the worst
 * case — #309 marked their missing process as unpublished precisely so they
 * would stop being re-queued, which means no future lookup will ever visit
 * them. Without this pass they stay `unknown` forever.
 *
 * Deliberately not a Dexie migration, for the reasons set out in
 * `backfillRoast.ts`: a migration cannot safely bump `updatedAt` or write
 * outbox rows from an upgrade transaction, and would never revisit a bean that
 * arrives later from another device still running an older build.
 *
 * ## Why silence stays silent
 *
 * The caffeine backfill writes a value to every bean it considers, falling back
 * to `caffeinated` when the text says nothing, because essentially all coffee
 * is caffeinated and `unknown` was recording an ignorance the user did not
 * have. There is no equivalent prior here. Blends and single origins are both
 * entirely ordinary, so a fallback would be wrong for roughly half the library
 * and would look exactly like a fact. This pass writes only where the coffee's
 * own text says something, and leaves the rest alone.
 *
 * ## Why it does not sync
 *
 * Same hazard the caffeine backfill documents, and the same fix. The pass runs
 * on app start alongside the sync engine; sending a locally derived value once
 * re-uploaded a bean another device had deleted, with a fresh `updatedAt`, and
 * last-write-wins handed the resurrection to every device.
 *
 * Composition as derived here is a pure function of `name` and
 * `roasterDescription`, both of which already sync, so every device computes
 * the same answer for itself and there is nothing worth sending. A device on an
 * older build simply reads `unknown`.
 *
 * A composition the user set by hand is the opposite case: it is a fact no
 * other device can derive, so the bean page writes it through the outbox
 * normally. This pass then leaves it alone forever, because it only ever writes
 * into a gap.
 */

/** A bean is a candidate while nothing has answered for it. */
function needsComposition(bean: CoffeeBean): boolean {
  return !bean.composition || bean.composition === 'unknown';
}

export interface CompositionBackfillResult {
  /** Beans with no composition when the pass started. */
  considered: number;
  /** Beans this pass resolved from their own text. */
  inferred: number;
}

/**
 * Runs one pass over every bean with no composition.
 *
 * Safe to call on every app start: a bean it fills stops matching, so repeated
 * runs converge and there is no "already ran" flag to fall out of step with the
 * data. A bean it cannot resolve is reconsidered next time, which is what we
 * want — its name may be corrected, or a lookup may add a description.
 */
export async function backfillComposition(): Promise<CompositionBackfillResult> {
  const candidates = (await db.beans.toArray()).filter(needsComposition);
  let inferred = 0;

  for (const bean of candidates) {
    const inference = inferComposition({
      name: bean.name,
      roasterDescription: bean.roasterDescription,
    });
    if (!inference) continue;

    inferred += 1;
    // No `updatedAt` bump and no outbox row: see the note above. Touching
    // either would let a locally derived value outrank a real change made
    // somewhere else, up to and including a delete.
    await db.beans.update(bean.id, { composition: inference.composition });
  }

  return { considered: candidates.length, inferred };
}
