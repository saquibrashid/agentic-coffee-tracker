/**
 * Renders the PNG app icons from the SVG sources in build-config/icons.
 *
 * The PNGs are committed rather than generated during the build, so `sharp` is
 * not a dependency of the app: it is a large binary package with platform
 * specific builds, and it would be installed on every CI run and by every
 * contributor to produce five files that only change when the logo does.
 *
 * Run it with `node scripts/generate-icons.mjs` after editing an SVG source.
 * It fetches sharp on demand via npx.
 *
 * Why PNG at all, when favicon.svg exists: iOS will not use an SVG for a home
 * screen icon, and the manifest icon sizes have to be real raster dimensions
 * for Chromium to consider the app installable.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (name) => path.join(root, 'build-config', 'icons', name);
const output = (name) => path.join(root, 'public', name);

const SHARP = 'sharp@0.34.4';

const targets = [
  { from: 'icon.svg', to: 'pwa-192x192.png', size: 192 },
  { from: 'icon.svg', to: 'pwa-512x512.png', size: 512 },
  { from: 'icon-maskable.svg', to: 'pwa-maskable-512x512.png', size: 512 },
  // 180 is the size current iPhones ask for; iOS downscales it for every other
  // slot it needs.
  { from: 'icon.svg', to: 'apple-touch-icon.png', size: 180 },
];

const script = `
const sharp = require(${'process.argv[2]'});
const targets = ${JSON.stringify(targets)};
(async () => {
  for (const t of targets) {
    await sharp(${JSON.stringify(path.join(root, 'build-config', 'icons'))} + '/' + t.from)
      .resize(t.size, t.size)
      .png({ compressionLevel: 9 })
      .toFile(${JSON.stringify(path.join(root, 'public'))} + '/' + t.to);
    console.log('wrote public/' + t.to + ' (' + t.size + 'x' + t.size + ')');
  }
})();
`;

const dir = mkdtempSync(path.join(tmpdir(), 'coffee-icons-'));
const file = path.join(dir, 'render.cjs');
writeFileSync(file, script);

// `npx -p sharp node ...` looks like the shorter way to do this and does not
// work: npx puts the package on PATH, not on Node's module resolution path, so
// the script still fails to require it. Installing into a temp prefix and
// requiring the absolute path is unambiguous.
console.log('Installing sharp (temporary, not added to the project)...');
execFileSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--prefix', dir, SHARP], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

execFileSync('node', [file, path.join(dir, 'node_modules', 'sharp')], { stdio: 'inherit' });

console.log('\nRendered from ' + targets.map((t) => path.basename(source(t.from))).join(', '));
console.log('Into ' + targets.map((t) => path.relative(root, output(t.to))).join(', '));
