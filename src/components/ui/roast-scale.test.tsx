import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { RoastScale, ROAST_ORDER, ROAST_SWATCH } from './roast-scale';

/**
 * Relative luminance and contrast, duplicated from contrast.test.ts because
 * these swatches are literal hex rather than theme tokens and the parser there
 * only reads HSL custom properties.
 */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const part = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('RoastScale', () => {
  it('renders nothing for an unknown or missing roast', () => {
    // Five empty rings would claim the coffee sits at the light end. Not
    // knowing the roast is a different statement from knowing it is light.
    const { container: missing } = render(<RoastScale level={undefined} />);
    expect(missing).toBeEmptyDOMElement();

    const { container: unknown } = render(<RoastScale level="unknown" />);
    expect(unknown).toBeEmptyDOMElement();
  });

  it('writes the level out when there is room for it', () => {
    render(<RoastScale level="medium-dark" />);
    expect(screen.getByText('Medium-dark')).toBeInTheDocument();
  });

  it('moves the level into the accessible name when compacted', () => {
    // WCAG 1.4.1: the position on the scale must not be carried by colour
    // alone. Compact mode drops the visible text, so the name has to carry it.
    render(<RoastScale level="light" compact />);
    expect(screen.getByRole('img', { name: 'Roast level: Light' })).toBeInTheDocument();
    expect(screen.queryByText('Light')).not.toBeInTheDocument();
  });

  it('does not announce the swatches twice', () => {
    render(<RoastScale level="medium" />);
    // The written level is already visible, so the graphic must not repeat it.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('dims exactly the steps past the current one', () => {
    const { container } = render(<RoastScale level="medium" />);
    const dots = container.querySelectorAll('.rounded-full');
    expect(dots).toHaveLength(ROAST_ORDER.length);

    const dimmed = Array.from(dots).map((dot) => dot.className.includes('opacity-25'));
    expect(dimmed).toEqual([false, false, false, true, true]);
  });
});

describe('roast swatches', () => {
  it('are ordered light to dark', () => {
    // The scale is only readable if it actually darkens. A swatch out of order
    // would make the graphic lie about where the coffee sits.
    const luminances = ROAST_ORDER.map((level) => luminance(ROAST_SWATCH[level]));
    const sorted = [...luminances].sort((a, b) => b - a);
    expect(luminances).toEqual(sorted);
  });

  it('keep adjacent steps distinguishable', () => {
    // Two neighbouring swatches at the same tone would collapse a five-point
    // scale into a four-point one without anything failing loudly.
    for (let i = 1; i < ROAST_ORDER.length; i += 1) {
      const previous = ROAST_SWATCH[ROAST_ORDER[i - 1]!];
      const current = ROAST_SWATCH[ROAST_ORDER[i]!];
      expect(contrast(previous, current)).toBeGreaterThan(1.35);
    }
  });

  it('span a wide enough range to read as a scale', () => {
    const lightest = ROAST_SWATCH[ROAST_ORDER[0]!];
    const darkest = ROAST_SWATCH[ROAST_ORDER[ROAST_ORDER.length - 1]!];
    expect(contrast(lightest, darkest)).toBeGreaterThan(6);
  });
});
