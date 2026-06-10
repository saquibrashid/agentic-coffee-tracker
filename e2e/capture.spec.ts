import { test, expect } from '@playwright/test';

// 1x1 PNG base64
const onePixelPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAE0lEQVR42mNk+M9QzwAEYgJ/k9QxGQAAAABJRU5ErkJggg==';

test('capture demo: upload image and receive mocked parse result', async ({ page }) => {
  await page.goto('/capture-demo');
  await expect(page.getByRole('heading', { name: /capture demo/i })).toBeVisible();

  const fileInput = page.locator('input[type="file"]');

  // Provide file via buffer to avoid needing a fixture file on disk
  await fileInput.setInputFiles({
    name: 'one-pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(onePixelPngBase64, 'base64'),
  });

  // Wait for processing text or parse result to appear
  await expect(page.getByText(/processing|parsing/i)).toHaveCount(0); // ensure no leftover

  // Wait for the parse result pre to become visible
  const pre = page.locator('pre');
  await expect(pre).toBeVisible({ timeout: 5000 });

  const text = await pre.textContent();
  expect(text).toContain('Mock Roaster Espresso Blend');
});
