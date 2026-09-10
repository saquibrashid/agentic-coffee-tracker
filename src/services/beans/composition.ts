/**
 * Whether a bag holds one coffee or several, kept as its own axis.
 *
 * The temptation is to record “blend” as a *process*, since a blend is the case
 * where the process is usually blank. Counter Culture's “Fast Forward” shows
 * why that is wrong: it is sold as a “Year-Round Blend” and its page also
 * states “Process: Washed”. The two facts are independent, and collapsing them
 * would make that coffee choose which one to keep.
 *
 * The cost would not stop at display. `process` feeds `favoriteProcesses` in
 * preferences, analytics and predict; a `blend` bucket there would read as “you
 * like blend-processed coffee”, and would swallow the real signal — someone
 * whose blends are all washed would show no washed preference at all, because
 * every one of them had been filed under blend.
 *
 * Composition is a genuine taste dimension in its own right. Some drinkers
 * reliably prefer the balance of a blend, others the clarity of a single lot,
 * and until now the app had no way to notice either.
 */
import type { CoffeeBean, Composition } from '@/types';

/** Every value, in the order they are offered wherever a choice is presented. */
export const COMPOSITIONS: Composition[] = ['blend', 'single-origin', 'unknown'];

/** How each value is written wherever the user sees it. */
export const COMPOSITION_LABELS: Record<Composition, string> = {
  blend: 'Blend',
  'single-origin': 'Single origin',
  unknown: 'Not known',
};

/**
 * The composition to reason with, absence included.
 *
 * There is deliberately no default here, which is where this differs from
 * caffeine. Essentially all coffee is caffeinated, so assuming it is nearly
 * always right; blends and single origins are both commonplace, so an
 * assumption either way would be wrong for about half the library. `unknown`
 * is the honest answer and the groupings simply skip it.
 */
export function compositionOf(bean: Pick<CoffeeBean, 'composition'>): Composition {
  return bean.composition ?? 'unknown';
}

/** True when the coffee is known to be one thing or the other. */
export function compositionKnown(bean: Pick<CoffeeBean, 'composition'>): boolean {
  return compositionOf(bean) !== 'unknown';
}
