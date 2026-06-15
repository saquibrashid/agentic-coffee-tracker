import { test, expect } from '@playwright/test';

// 1x1 PNG base64
const onePixelPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAE0lEQVR42mNk+M9QzwAEYgJ/k9QxGQAAAABJRU5ErkJggg==';

test('capture demo: upload image and receive mocked parse result', async ({ page, browserName }) => {
  // Canvas image processing of inline data URLs can be flaky in headless WebKit; skip there.
  test.skip(browserName === 'webkit', 'Flaky in headless WebKit (canvas/data-url).');

  await page.goto('/capture-demo');
  await expect(page.getByRole('heading', { name: /capture demo/i })).toBeVisible();

  const fileInput = page.locator('input[type="file"]');

  // Provide file via buffer to avoid needing a fixture file on disk
  await fileInput.setInputFiles({
    name: 'one-pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(onePixelPngBase64, 'base64'),
  });

  // Wait for the parse result pre to become visible
  const pre = page.locator('pre');
  await expect(pre).toBeVisible({ timeout: 15000 });

  const text = await pre.textContent();
  expect(text).toContain('Mock Roaster');
});
