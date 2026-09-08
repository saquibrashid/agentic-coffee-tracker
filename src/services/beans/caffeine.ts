/**
 * The single definition of what a coffee's caffeine content is, and of which
 * coffees belong together when taste is being measured.
 *
 * Decaf is not a variant of a coffee, it is a different drink made from one.
 * The decaffeination process itself strips aromatics and flattens acidity, so a
 * decaf scored 6 and a caffeinated coffee scored 6 are not the same judgement:
 * the first is "good for a decaf" and the second is not. Averaging them
 * together produces a taste profile belonging to nobody — and worse, it drags
 * recommendations toward whichever group the user drinks more of, which is
 * usually caffeinated, so the decaf a user actually enjoyed counts as evidence
 * against their own preferences.
 *
 * Everything that ranks, averages or recommends reads the rule from here.
 * `services/preferences/compute.ts` and the Analytics screen rank the same
 * values from the same ratings and have to agree (#202); two copies of this
 * predicate is exactly how that agreement is lost.
 */
import type { CaffeineLevel, CoffeeBean } from '@/types';

/**
 * The stored value, with absent normalised to `'unknown'`.
 *
 * Every coffee recorded before the field existed has no value at all, and that
 * is indistinguishable from one nobody has answered for. Both are `'unknown'`.
 */
export function caffeineOf(bean: Pick<CoffeeBean, 'caffeine'>): CaffeineLevel {
  return bean.caffeine ?? 'unknown';
}

/**
 * True for coffee that has had its caffeine removed.
 *
 * `half-caf` is excluded: it is a distinct product, and lumping it in would
 * make the two groups disagree about the same bag depending on which side
 * asked.
 */
export function isDecaf(bean: Pick<CoffeeBean, 'caffeine'>): boolean {
  return caffeineOf(bean) === 'decaf';
}

/**
 * Whether two coffees belong in the same taste comparison.
 *
 * `unknown` matches everything on purpose. Treating it as its own group would
 * split the library in half on the day this field shipped, because every
 * existing coffee is unknown — the user would find their preferences suddenly
 * computed from nothing. An unlabelled coffee is overwhelmingly likely to be
 * caffeinated, and being wrong about a handful is a far smaller error than
 * discarding the entire history.
 *
 * `backfillCaffeine` has since made `unknown` rare rather than universal, but
 * the rule stays: a coffee arriving from a device that has not run the backfill
 * is still unknown, and it should behave as it always did rather than fall out
 * of the user's history for as long as that other device stays behind.
 */
export function comparableCaffeine(
  a: Pick<CoffeeBean, 'caffeine'>,
  b: Pick<CoffeeBean, 'caffeine'>,
): boolean {
  const left = caffeineOf(a);
  const right = caffeineOf(b);
  if (left === 'unknown' || right === 'unknown') return true;
  return left === right;
}

/**
 * What a coffee is taken to be when nothing anywhere says otherwise.
 *
 * This is a claim about the world, not about the data: essentially all coffee
 * sold is caffeinated, and decaf is the case a roaster goes out of its way to
 * mark. Recording a new bean as `unknown` is therefore technically honest and
 * practically useless — it describes a coffee we are already confident about,
 * and it excludes that coffee from every grouping that separates decaf from
 * caffeinated, which is the reason the field exists.
 *
 * The assumption is only ever applied where a human is present to correct it:
 * at capture, where it becomes the pre-filled value on a form the user is about
 * to confirm, and in the backfill, which the user asked for. It is deliberately
 * *not* applied by `inferCaffeine`, which reports evidence and nothing else, so
 * that enrichment never proposes overwriting a decaf someone set by hand.
 */
export const DEFAULT_CAFFEINE: CaffeineLevel = 'caffeinated';

/** How each value is written wherever the user sees it. */
export const CAFFEINE_LABELS: Record<CaffeineLevel, string> = {
  caffeinated: 'Caffeinated',
  decaf: 'Decaf',
  'half-caf': 'Half-caf',
  unknown: 'Not known',
};
