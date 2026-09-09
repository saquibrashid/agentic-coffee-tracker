/**
 * How a coffee is packaged, read in one place.
 *
 * Cometeer, Nespresso and K-Cup are delivery systems, not roasters and not
 * shops: a Cometeer box of Counter Culture coffee is Counter Culture's coffee
 * flash-frozen into pucks. The shop it was carried out of — a grocery store, a
 * marketplace — is not recorded anywhere, because it says nothing about the
 * coffee.
 *
 * The default lives in this reader rather than in a value written at capture.
 * `caffeine` took the opposite route and needed `caffeineForNewBean` plus a
 * separate rule for old records; defaulting on read means a coffee saved before
 * this field existed and a plain bag saved today answer the same way, with no
 * migration and no chance of a stored `whole-bean` being mistaken for something
 * the bag actually claimed.
 *
 * Everything that displays or filters on packaging reads it from here, for the
 * reason `services/beans/caffeine.ts` gives: two copies of a defaulting rule is
 * how the screens stop agreeing (#202).
 */
import type { CoffeeBean, CoffeeFormat } from '@/types';

/** What a coffee is assumed to be when nothing says otherwise. */
export const DEFAULT_FORMAT: CoffeeFormat = 'whole-bean';

/** The stored value, with absent normalised to the default. */
export function formatOf(bean: Pick<CoffeeBean, 'format'>): CoffeeFormat {
  return bean.format ?? DEFAULT_FORMAT;
}

/**
 * True when the packaging is worth saying out loud.
 *
 * Nearly every coffee is a bag of beans, so labelling each one "Whole bean"
 * would add a word to every row that distinguishes nothing. The interesting
 * cases are the ones that are not.
 */
export function hasNotableFormat(bean: Pick<CoffeeBean, 'format'>): boolean {
  return formatOf(bean) !== DEFAULT_FORMAT;
}

export const FORMAT_LABELS: Record<CoffeeFormat, string> = {
  'whole-bean': 'Whole bean',
  ground: 'Ground',
  cometeer: 'Cometeer',
  nespresso: 'Nespresso',
  'k-cup': 'K-Cup',
  instant: 'Instant',
};

/** The human name for a stored value, e.g. `'k-cup'` -> `'K-Cup'`. */
export function formatLabel(bean: Pick<CoffeeBean, 'format'>): string {
  return FORMAT_LABELS[formatOf(bean)];
}
