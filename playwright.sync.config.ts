import { defineConfig, devices } from '@playwright/test';

/**
 * A second Playwright project, for the two-device sync test alone.
 *
 * It needs its own config because it needs its own *server*: sync is gated
 * behind `VITE_AUTH_ENABLED`, which the normal dev server deliberately leaves
 * unset so that `vite dev` cannot offer a sign-in button for `/.auth/*`
 * endpoints it does not serve. Flipping that flag on the shared dev server
 * would change the conditions every other e2e test runs under, to make one test
 * work — so this gets a separate server on a separate port instead.
 *
 * Single-worker throughout. The test drives two browser contexts against one
 * in-process fake sync service, and a second worker would be a second service
 * with a second view of the same assertions.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.sync\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // The whole reason this config exists. `services/auth` accepts only the
      // exact string 'true', by design.
      VITE_AUTH_ENABLED: 'true',
    },
  },
});
