import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { APPLE_TOUCH_ICON, PWA_ICONS } from './pwaIcons';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicFile = (src: string) => path.join(root, 'public', src.replace(/^\//, ''));

/**
 * Reads a PNG's real width and height out of its IHDR chunk, which is always
 * the first chunk and always at a fixed offset.
 *
 * Checking the declared `sizes` against the actual pixels matters because a
 * wrong one is invisible: browsers trust `sizes` when choosing an icon and only
 * discover the mismatch when they draw it.
 */
function pngSize(file: string): { width: number; height: number } {
  const buffer = readFileSync(file);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buffer.subarray(0, 8).equals(signature), `${file} is not a PNG`).toBe(true);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('PWA icons', () => {
  it.each(PWA_ICONS)('$src exists at the size the manifest claims', (icon) => {
    const file = publicFile(icon.src);
    expect(existsSync(file), `${icon.src} is in the manifest but not in public/`).toBe(true);

    const [width, height] = icon.sizes.split('x').map(Number);
    expect(pngSize(file)).toEqual({ width, height });
  });

  it('offers the two sizes Chromium requires before it will install an app', () => {
    const square = PWA_ICONS.filter((i) => i.purpose !== 'maskable').map((i) => i.sizes);
    expect(square).toContain('192x192');
    expect(square).toContain('512x512');
  });

  it('draws the maskable icon separately from the standard one', () => {
    const maskable = PWA_ICONS.filter((i) => i.purpose === 'maskable');
    expect(maskable.length).toBeGreaterThan(0);
    const standard = new Set(PWA_ICONS.filter((i) => i.purpose !== 'maskable').map((i) => i.src));
    for (const icon of maskable) {
      expect(standard.has(icon.src), `${icon.src} is served as both standard and maskable`).toBe(
        false,
      );
    }
  });

  it('ships the icon iOS actually uses for the home screen', () => {
    const file = publicFile(APPLE_TOUCH_ICON);
    expect(existsSync(file), `${APPLE_TOUCH_ICON} is missing`).toBe(true);
    expect(pngSize(file)).toEqual({ width: 180, height: 180 });
  });

  it('is linked from index.html, which is the only place iOS looks', () => {
    const html = readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(html).toContain(`rel="apple-touch-icon" href="${APPLE_TOUCH_ICON}"`);
    // Without this, iOS ignores the manifest's `display: standalone` and opens
    // the home-screen shortcut in a browser tab with the address bar showing.
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
  });
});
