import { describe, it, expect } from 'vitest';

import css from './globals.css?raw';

/**
 * The typeface is the largest single contributor to how finished the app looks
 * and the easiest thing to break silently: a renamed font file, a dropped
 * `@font-face`, or a heading rule that stops matching all leave the app
 * rendering in Georgia with nothing failing.
 */
describe('display typeface', () => {
  it('is self-hosted rather than fetched from a font service', () => {
    // A third-party font request is an extra connection on the critical path
    // and a per-page-view disclosure of the reader's IP to someone else.
    expect(css).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit/);
    expect(css).toMatch(/@fontsource-variable\/fraunces/);
  });

  it('loads only the latin weight axis', () => {
    // The italic and wonk files are another ~90 KB for very little; if one
    // gets added by accident this is where it shows up.
    const sources = [...css.matchAll(/url\('([^']*\.woff2)'\)/g)].map((match) => match[1]!);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toContain('latin-wght-normal');
  });

  it('uses font-display: swap so headings are never invisible', () => {
    expect(css).toMatch(/font-display:\s*swap/);
  });

  it('declares a variable weight range rather than a single weight', () => {
    expect(css).toMatch(/font-weight:\s*100 900/);
  });

  it('falls back to a serif, not the body sans', () => {
    // A serif heading dropping to the system sans is a bigger visual jump than
    // dropping to Georgia, and Georgia is present on effectively every device.
    const displayStack = /--font-display:\s*([^;]+);/.exec(css)?.[1] ?? '';
    expect(displayStack).toContain('Fraunces Variable');
    expect(displayStack).toContain('Georgia');
    expect(displayStack.trim().endsWith('serif')).toBe(true);
  });

  it('applies the display face to headings globally', () => {
    // At the element level rather than per call site, so a new page cannot
    // forget it.
    expect(css).toMatch(/h1,\s*h2,\s*h3,\s*h4\s*\{[^}]*font-family:\s*var\(--font-display\)/);
  });

  it('keeps body text on the system stack', () => {
    // Deliberate: a second webfont for body would double the font payload for
    // the least distinctive text on the page.
    const sansStack = /--font-sans:\s*([^;]+);/.exec(css)?.[1] ?? '';
    expect(sansStack).toContain('system-ui');
    expect(sansStack).not.toContain('Fraunces');
  });
});

describe('kraft grain', () => {
  it('is generated in CSS rather than downloaded', () => {
    // An image asset would count against the Lighthouse budget for something
    // the user should never consciously notice.
    const grain = /body::before\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(grain).toMatch(/repeating-linear-gradient/);
    expect(grain).not.toMatch(/url\(/);
  });

  it('does not intercept clicks or joins the tab order', () => {
    const grain = /body::before\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(grain).toMatch(/pointer-events:\s*none/);
    expect(grain).toMatch(/z-index:\s*-1/);
  });

  it('is re-tinted for dark mode', () => {
    // A dark-on-dark grain is invisible; without this the texture silently
    // disappears for half the users.
    expect(css).toMatch(/\.dark body::before/);
  });
});
