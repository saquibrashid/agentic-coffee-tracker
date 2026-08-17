/**
 * The one rule the app uses to rank a value by how much the user liked it.
 *
 * Two screens answer the same question from the same ratings — the taste map on
 * "For you" and the panels on Analytics — and until issue #202 they each had
 * their own arithmetic, so they could put the same history in a different order
 * and both look authoritative. The rule lives here so that cannot happen again.
 *
 * A raw average is not usable for ranking a hobby history: most values are
 * backed by one or two ratings, and the top of any such list is simply whichever
 * coffee the user happened to score highest once. Shrinking each average toward
 * the user's own overall average, in proportion to how little evidence stands
 * behind it, holds that back — while never letting volume decide the order,
 * because shrinkage can only pull a value *toward* the mean and never past it.
 * Something scored below the user's own average therefore cannot outrank
 * something scored above it, however often they drink it.
 */

/**
 * How many ratings' worth of "you are probably average at this" to assume before
 * believing a value's own average.
 *
 * At `PRIOR_STRENGTH` observations the ranked score sits halfway between the
 * user's overall average and what this value actually scored. Five is a
 * deliberate choice for a hobby history measured in dozens of ratings, not
 * thousands: it leaves a 2-rating note visibly hedged and lets a 12-rating one
 * speak almost for itself.
 */
export const PRIOR_STRENGTH = 5;

/**
 * `averageScore` pulled toward `baseline` according to `count`.
 *
 * Returns a value on the same 1–10 scale as the average it was given, so it can
 * be shown, compared against the baseline, and drawn as a bar without any
 * further conversion.
 */
export function shrinkToBaseline(count: number, averageScore: number, baseline: number): number {
  if (count <= 0) return baseline;
  return (count * averageScore + PRIOR_STRENGTH * baseline) / (count + PRIOR_STRENGTH);
}
