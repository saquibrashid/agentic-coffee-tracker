import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true,
      },
    },
  },
  build: {
    // recharts is the largest single dependency and is only pulled in by the
    // (lazy) analytics route, so it sits above the app-code threshold on purpose.
    chunkSizeWarningLimit: 400,
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
          ],
        },
      },
    },
  },
  plugins: [
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
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
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
