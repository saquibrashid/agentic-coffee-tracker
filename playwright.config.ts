import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // The two-device sync test runs under `playwright.sync.config.ts`: it needs a
  // dev server with VITE_AUTH_ENABLED set, which would change the conditions
  // every test here runs under. The CSP suite runs under
  // `playwright.csp.config.ts`, against a production build served with the real
  // policy — this dev server serves a laxer one, so running it here would prove
  // nothing.
  testIgnore: [/.*\.sync\.spec\.ts/, /csp\.spec\.ts/],
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // A fake capture device, so the in-app camera (#145) can be exercised
        // against a real getUserMedia rather than a jsdom stand-in. The fake UI
        // flag auto-accepts the permission prompt, which is otherwise
        // unanswerable in a headless run. Harmless for every other spec: it
        // only makes a camera available, it does not use one.
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
