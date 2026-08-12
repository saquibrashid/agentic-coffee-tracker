import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { readFileSync } from 'node:fs';

import { buildCsp } from './build-config/csp';
import { cspPlugin } from './build-config/cspPlugin';
import { NAVIGATION_FALLBACK_DENYLIST } from './build-config/serviceWorker';

// Supplied by `azd` from the infrastructure outputs of the same names. Absent
// on a local build, which is correct: without a linked backend the browser
// never talks to Blob Storage, so the policy should not say it may.
const photoStorageAccount = process.env.AZURE_PHOTO_STORAGE_ACCOUNT_NAME;
const apiBaseUrl = process.env.VITE_API_BASE_URL;

/**
 * The dev and preview servers send the policy too, so that a mistake in it
 * shows up in the e2e suite rather than in production.
 *
 * Static Web Apps serves the real header from `staticwebapp.config.json`, which
 * exists only in a deployed build — without this, every local run would be
 * exercising an app that has no CSP at all, and the first evidence of a broken
 * policy would be a user hitting it. `preview` is the honest one: a production
 * bundle under the production policy. `dev` is necessarily laxer.
 */
const devCsp = buildCsp({ scriptHashes: [], dev: true, photoStorageAccount, apiBaseUrl });

/**
 * The header the last build actually emitted, replayed by `vite preview`.
 *
 * Read back out of the built artifact rather than recomputed, so the e2e suite
 * that runs against preview is testing the bytes that ship — including the
 * script hash — and not a second opinion that could agree with the source while
 * both disagree with `dist/`.
 */
function builtCsp(): string | undefined {
  try {
    const config = JSON.parse(
      readFileSync(path.resolve(__dirname, 'dist/staticwebapp.config.json'), 'utf8'),
    ) as { globalHeaders?: Record<string, string> };
    return config.globalHeaders?.['content-security-policy'];
  } catch {
    // No build yet. `vite preview` will fail on its own, and more clearly.
    return undefined;
  }
}

const previewCsp = builtCsp();

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    headers: { 'content-security-policy': devCsp },
    proxy: {
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    ...(previewCsp ? { headers: { 'content-security-policy': previewCsp } } : {}),
  },
  build: {
    // recharts is the largest single dependency and is only pulled in by the
    // (lazy) analytics route, so it sits above the app-code threshold on purpose.
    chunkSizeWarningLimit: 400,
    /**
     * Keeps the PDF reader out of the landing page's preload list.
     *
     * Splitting it into its own chunk is not enough on its own: the entry still
     * emits a `<link rel="modulepreload">` for it, which makes the browser
     * fetch all ~400KB before anything asks for it — the eager download that
     * code-splitting it was meant to avoid. Dropping the hint costs a
     * PDF-uploading user one round trip and saves everyone else the whole file.
     */
    modulePreload: {
      resolveDependencies: (_url, deps) => deps.filter((dep) => !/[\\/]pdf-[^\\/]*\.js$/.test(dep)),
    },
    // Vite 8 bundles with Rolldown, which dropped the object form of
    // `manualChunks` and deprecated the function form. `codeSplitting.groups`
    // is the replacement. `includeDependenciesRecursively` (on by default, set
    // explicitly here because the whole point of these groups is the subtree)
    // restores what the object form did implicitly: pull each package's private
    // dependencies in with it, so recharts' d3 modules land in the charts chunk
    // rather than leaking back into the entry.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              // Framework code changes rarely — splitting it out keeps it cached
              // across app deploys.
              name: 'react',
              test: /node_modules[\\/](?:react|react-dom|react-router-dom)(?:[\\/]|$)/,
              includeDependenciesRecursively: true,
            },
            {
              name: 'charts',
              test: /node_modules[\\/]recharts(?:[\\/]|$)/,
              includeDependenciesRecursively: true,
            },
            {
              name: 'db',
              test: /node_modules[\\/](?:dexie|dexie-react-hooks)(?:[\\/]|$)/,
              includeDependenciesRecursively: true,
            },
            {
              // Named explicitly so the service worker can recognise it by
              // filename and keep it out of the precache — see `globIgnores`.
              name: 'pdf',
              test: /node_modules[\\/]pdfjs-dist(?:[\\/]|$)/,
              includeDependenciesRecursively: true,
            },
          ],
        },
      },
    },
  },
  plugins: [
    cspPlugin({ photoStorageAccount, apiBaseUrl }),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'robots.txt', 'apple-touch-icon.png'],
      manifest: {
        name: 'Agentic Coffee Tracker',
        short_name: 'Coffee',
        description: 'Offline-first, AI-powered coffee tracking.',
        // Manifest colours are static — they are read at install time and
        // cannot follow the theme, unlike the <meta name="theme-color"> the
        // app rewrites at runtime. They match the light palette so the splash
        // screen agrees with the first paint for the common case.
        theme_color: '#faf7f2',
        background_color: '#faf7f2',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: NAVIGATION_FALLBACK_DENYLIST,
        // The PDF reader and its worker are ~1.6MB together and are only
        // reached by someone who actually uploads a PDF. Precaching them would
        // make every install — including the first visit, on whatever
        // connection — pay for a feature most people never open. They are
        // cached on first use instead, which also means the second PDF works
        // offline.
        globIgnores: ['**/pdf-*.js', '**/pdf.worker*.mjs'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(?:pdf-[^/]*\.js|pdf\.worker[^/]*\.mjs)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pdf-reader',
              // Content-hashed filenames, so an entry is only ever replaced by
              // a differently named one; the cap stops old builds accumulating.
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
