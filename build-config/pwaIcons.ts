/**
 * The app's icon set, shared by vite.config.ts (which puts it in the web app
 * manifest) and pwaIcons.test.ts (which checks the files are really there).
 *
 * It lives in its own module because the manifest previously listed icons that
 * did not exist: /pwa-192x192.png, /pwa-512x512.png and /apple-touch-icon.png
 * all 404'd in production. Nothing failed — the manifest was still valid JSON
 * and still served — so the app simply was not installable, and iOS used a
 * screenshot of the page as the home-screen icon. A list nobody can check is
 * how that happens twice.
 *
 * The PNGs are generated from build-config/icons/*.svg by
 * scripts/generate-icons.mjs and committed.
 */

export interface PwaIcon {
  src: string;
  sizes: string;
  type: 'image/png';
  purpose?: 'maskable';
}

/**
 * Chromium will not treat an app as installable without a 192px and a 512px
 * icon that actually load, so these two are the minimum, not a nicety.
 */
export const PWA_ICONS: PwaIcon[] = [
  { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
  { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
  // A separate drawing rather than the same file tagged differently: a maskable
  // icon is cropped to whatever shape the platform prefers and only its middle
  // 80% is guaranteed to survive, so the mark has to be drawn smaller.
  { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/**
 * iOS does not read the manifest's icons when adding to the home screen; it
 * looks for <link rel="apple-touch-icon">. Referenced from index.html, and
 * listed in the plugin's `includeAssets` so the service worker precaches it.
 */
export const APPLE_TOUCH_ICON = '/apple-touch-icon.png';
