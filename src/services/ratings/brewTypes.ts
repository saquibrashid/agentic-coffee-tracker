import type { BrewType } from '@/types';

/**
 * The brew-type vocabulary, shared by the rating form, the CSV importer and
 * anywhere else that has to show or default one.
 *
 * Ordered for the picker with the default first. The union in `@/types` is the
 * source of truth, so adding a brew type there fails to compile here until it is
 * also offered to the user.
 */
export const BREW_TYPE_OPTIONS: { value: BrewType; label: string }[] = [
  { value: 'latte', label: 'Latte' },
  { value: 'drip', label: 'Drip' },
  { value: 'espresso', label: 'Espresso' },
  { value: 'pour-over', label: 'Pour-over' },
  { value: 'iced-latte', label: 'Iced latte' },
  { value: 'cappuccino', label: 'Cappuccino' },
  { value: 'cortado', label: 'Cortado' },
  { value: 'americano', label: 'Americano' },
  { value: 'french-press', label: 'French press' },
  { value: 'aeropress', label: 'AeroPress' },
  { value: 'moka', label: 'Moka' },
  { value: 'cold-brew', label: 'Cold brew' },
  { value: 'other', label: 'Other' },
];

/**
 * Assumed when nothing else is known — a blank brew column on an imported row,
 * or an untouched rating form. Only ever a stand-in for *absent* information:
 * a brew that was stated but not recognised becomes `other`, because guessing
 * "latte" there would invent history the user never recorded.
 */
export const DEFAULT_BREW_TYPE: BrewType = 'latte';

export function brewLabel(value: BrewType): string {
  return BREW_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
