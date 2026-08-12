/**
 * WCAG contrast assertions over the real theme tokens.
 *
 * `specs/ux-states.md` requires AA. That requirement was previously enforced by
 * nobody: the tokens are plain CSS, so a palette change could quietly drop
 * body text to 3:1 and every test would still pass.
 *
 * This parses `globals.css` itself rather than duplicating the values, so it
 * fails when the palette changes rather than when someone forgets to update a
 * copy of it. It is the safety net that made retuning the dark palette to a
 * deep brown (issue #110) a change we can verify instead of hope about.
 */
import { describe, expect, it } from 'vitest';

// Imported as text rather than read through node:fs, so the test uses the same
// module graph as the app and needs no node type definitions in the client
// tsconfig. The point is that it reads the *real* stylesheet: duplicating the
// values here would let the palette drift without failing anything.
import css from './globals.css?raw';

/** WCAG 2.1: 4.5:1 for body text, 3:1 for large text and UI boundaries. */
const AA_TEXT = 4.5;
const AA_LARGE = 3;

type Hsl = [h: number, s: number, l: number];

/**
 * Pulls the token block for a selector. The two blocks define the same names,
 * so they have to be read separately or `.dark` values would overwrite `:root`.
 */
function readTokens(selector: string): Map<string, Hsl> {
  const block = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(css);
  if (!block?.[1]) throw new Error(`No token block found for ${selector}`);

  const tokens = new Map<string, Hsl>();
  const declaration = /--([a-z-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(block[1])) !== null) {
    tokens.set(match[1]!, [Number(match[2]), Number(match[3]), Number(match[4])]);
  }
  return tokens;
}

function hslToRgb([h, s, l]: Hsl): [number, number, number] {
  const saturation = s / 100;
  const lightness = l / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = lightness - c / 2;

  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];

  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** WCAG relative luminance. */
function luminance(colour: Hsl): number {
  const [r, g, b] = hslToRgb(colour).map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Hsl, b: Hsl): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Text pairings that must clear 4.5:1, named as they appear in the UI. */
const TEXT_PAIRS: Array<[string, string]> = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  /*
   * `--destructive` is used *as text* — `text-destructive` on error messages
   * and the "Danger zone" heading — not only as a button fill. That was missed
   * the first time round, and the gap surfaced only when CardTitle shrank from
   * 24px to 18px and the pairing dropped out of the large-text exemption.
   * Asserting it here means the palette, not the font size, is what has to be
   * safe.
   */
  ['destructive', 'background'],
  ['destructive', 'card'],
];

describe.each(['\\:root', '\\.dark'])('%s palette', (selector) => {
  const tokens = readTokens(selector);
  const get = (name: string): Hsl => {
    const value = tokens.get(name);
    if (!value) throw new Error(`Missing token --${name} in ${selector}`);
    return value;
  };

  it.each(TEXT_PAIRS)('%s on %s meets AA for body text', (fg, bg) => {
    expect(contrast(get(fg), get(bg))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // Non-text contrast (WCAG 1.4.11) applies to boundaries that *identify* a
  // control, not to decoration. An input's edge is the only thing saying "you
  // can type here", and a focus ring is the only thing saying "you are here",
  // so both must clear 3:1. A divider between a card and the page is
  // decorative and is held only to being perceptible — demanding 3:1 there
  // would force a harsh outline around every surface.
  it.each([
    ['input', 'background'],
    ['input', 'card'],
    ['ring', 'background'],
    ['ring', 'card'],
    ['primary', 'background'],
  ])('%s against %s meets AA for non-text contrast', (fg, bg) => {
    expect(contrast(get(fg), get(bg))).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it.each([
    ['border', 'background'],
    ['border', 'card'],
  ])('%s against %s stays perceptible', (fg, bg) => {
    expect(contrast(get(fg), get(bg))).toBeGreaterThan(1.2);
  });

  // Cards are distinguished from the page by a fill, not only a border, so the
  // two surfaces must not resolve to the same colour.
  it('separates the card surface from the page background', () => {
    expect(contrast(get('card'), get('background'))).toBeGreaterThan(1.05);
  });
});

describe('dark palette is brown rather than near-black', () => {
  const dark = readTokens('\\.dark');

  // The point of issue #110: hue is imperceptible below roughly 12% lightness,
  // so "warm hue, very dark" reads as black. These bounds keep the background
  // recognisably brown without letting it drift light enough to lose contrast.
  it('keeps the background light enough for the hue to register', () => {
    const [hue, saturation, lightness] = dark.get('background')!;
    expect(hue).toBeGreaterThanOrEqual(15);
    expect(hue).toBeLessThanOrEqual(35);
    expect(saturation).toBeGreaterThanOrEqual(25);
    expect(lightness).toBeGreaterThanOrEqual(12);
    expect(lightness).toBeLessThanOrEqual(18);
  });

  it('keeps every dark surface on a warm hue', () => {
    for (const name of ['background', 'card', 'secondary', 'muted', 'accent', 'border']) {
      const [hue, saturation] = dark.get(name)!;
      expect(hue, `--${name} hue`).toBeGreaterThanOrEqual(15);
      expect(hue, `--${name} hue`).toBeLessThanOrEqual(35);
      expect(saturation, `--${name} saturation`).toBeGreaterThan(15);
    }
  });

  /*
   * Dark mode has to work harder than light mode to make a card look like a
   * card, and the shared 1.05 floor above is far too generous to catch it.
   *
   * Light mode separates the two surfaces three ways over: a pure white card
   * against a tinted page, a border, and a drop shadow that actually lands.
   * On a dark page the shadow is invisible and both surfaces share a hue, so
   * lightness is the only cue left — which is why it is held to a real number
   * here. At the original four-point step the cards dissolved into the page.
   */
  it('lifts a card clearly off the page', () => {
    const [, , backgroundL] = dark.get('background')!;
    const [, , cardL] = dark.get('card')!;
    expect(cardL - backgroundL).toBeGreaterThanOrEqual(7);
  });

  /*
   * Every surface that can be painted *onto* a card — a muted badge, a
   * secondary button — has to stay distinguishable from it. These sit within
   * a few points of the card, so raising the card without raising them is an
   * easy way to make a control silently vanish.
   */
  it('keeps stacked surfaces above the card', () => {
    const [, , cardL] = dark.get('card')!;
    for (const name of ['secondary', 'muted', 'accent']) {
      const [, , lightness] = dark.get(name)!;
      expect(lightness, `--${name} lightness`).toBeGreaterThan(cardL);
    }
  });
});
