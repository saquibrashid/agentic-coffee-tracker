import type { RoastLevel } from '@/types';

import { cn } from '@/lib/utils';

/**
 * The bean colours themselves, light to dark, as they actually appear: a pale
 * cinnamon through to a near-black French roast.
 *
 * These are literal swatch values, not theme tokens, and that is deliberate.
 * A roast level means the same thing in light and dark mode — recolouring it
 * per theme would be recolouring the data. What does change per theme is the
 * ring around the swatch, which exists only so a dark swatch stays visible on
 * a dark page.
 */
const ROAST_SWATCH: Record<RoastLevel, string> = {
  light: '#c8a06a',
  'medium-light': '#a9763f',
  medium: '#87542a',
  'medium-dark': '#5f3819',
  dark: '#38200e',
  unknown: 'transparent',
};

/** Position on the scale, 0-indexed, for the filled-dots rendering. */
const ROAST_ORDER: RoastLevel[] = ['light', 'medium-light', 'medium', 'medium-dark', 'dark'];

const ROAST_LABEL: Record<RoastLevel, string> = {
  light: 'Light',
  'medium-light': 'Medium-light',
  medium: 'Medium',
  'medium-dark': 'Medium-dark',
  dark: 'Dark',
  unknown: 'Unknown',
};

export interface RoastScaleProps {
  level: RoastLevel | undefined;
  /** Hide the written level and show only the swatches. */
  compact?: boolean;
  className?: string;
}

/**
 * Roast level as a visual scale rather than a word.
 *
 * Colour is doing real work here: five swatches show *where on the range* a
 * coffee sits, which the string "medium-dark" only tells you if you already
 * know the full list. The position is legible at a glance in a list of twenty
 * beans, which the string is not.
 *
 * Colour is never the only channel. The written level is present unless the
 * caller compacts it, and in the compact form it moves to the accessible name
 * — so this satisfies WCAG 1.4.1 rather than relying on the reader
 * distinguishing two browns.
 *
 * An unknown roast renders nothing. Five empty rings would imply we know the
 * coffee is at the light end, which is a different claim from not knowing.
 */
export function RoastScale({ level, compact = false, className }: RoastScaleProps) {
  if (level === undefined || level === 'unknown') return null;

  const index = ROAST_ORDER.indexOf(level);
  if (index === -1) return null;

  const label = `Roast level: ${ROAST_LABEL[level]}`;

  /*
   * The graphic is only a graphic when it is the sole carrier of the meaning.
   * In the full form the level is written beside it, so exposing a second,
   * identically-named `img` would make a screen reader say it twice — and a
   * `role="img"` with no accessible name is itself a violation.
   */
  return (
    <span
      className={cn('inline-flex items-center gap-2', className)}
      {...(compact ? { role: 'img', 'aria-label': label } : {})}
    >
      <span className="flex items-center gap-1" aria-hidden="true">
        {ROAST_ORDER.map((step, stepIndex) => (
          <span
            key={step}
            className={cn(
              // The ring is theme-aware where the fill is not: a near-black
              // dark-roast swatch has no edge against a dark card, and a pale
              // light-roast swatch has none against a light one. Deriving it
              // from --foreground inverts it automatically with the theme.
              'ring-foreground/30 size-2.5 rounded-full ring-1',
              stepIndex > index && 'opacity-25',
            )}
            style={{ backgroundColor: ROAST_SWATCH[step] }}
          />
        ))}
      </span>
      {!compact && (
        // Never break "Medium-dark" across lines at its hyphen — in a narrow
        // column that reads as two different roast levels.
        <span className="text-meta text-muted-foreground whitespace-nowrap">
          {ROAST_LABEL[level]}
        </span>
      )}
    </span>
  );
}

export { ROAST_SWATCH, ROAST_ORDER, ROAST_LABEL };
