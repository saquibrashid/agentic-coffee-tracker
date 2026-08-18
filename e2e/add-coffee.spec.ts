import { test, expect } from '@playwright/test';

// 1x1 PNG — enough to exercise resize + persist without a fixture on disk.
const onePixelPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAE0lEQVR42mNk+M9QzwAEYgJ/k9QxGQAAAABJRU5ErkJggg==';

test.describe('Add a coffee', () => {
  // Canvas processing of inline data URLs is flaky in headless WebKit, and the
  // resulting Blob cannot be stored in IndexedDB there either. Real iOS Safari
  // handles both — verified by hand on a device in #100 — so this is an
  // automation limitation, not an app defect. Re-check with
  // `node scripts/webkit-blob-probe.mjs` after a Playwright upgrade.
  test.skip(({ browserName }) => browserName === 'webkit', 'Flaky in headless WebKit.');

  test('capture a bag photo and confirm the extracted details', async ({ page }) => {
    await page.goto('/add');
    await expect(page.getByRole('heading', { name: 'Add a coffee' })).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'bag.png',
      mimeType: 'image/png',
      buffer: Buffer.from(onePixelPngBase64, 'base64'),
    });

    // The BFF is not running in CI, so the pipeline falls back to local mocks
    // and lands on the confirmation form.
    const roaster = page.getByLabel(/roaster/i);
    await expect(roaster).toBeVisible({ timeout: 20000 });

    await roaster.fill('Onyx Coffee Lab');
    await page.getByLabel(/coffee name/i).fill('Geometry');
    await page.getByLabel(/tasting notes/i).fill('peach, jasmine');
    await page.getByRole('button', { name: /save coffee/i }).click();

    // Saving navigates to the bean detail page for the new record.
    await expect(page).toHaveURL(/\/beans\//, { timeout: 15000 });
    await expect(page.getByText('Geometry')).toBeVisible();
  });

  test('the raw label text is available for manual correction', async ({ page }) => {
    await page.goto('/add');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'bag.png',
      mimeType: 'image/png',
      buffer: Buffer.from(onePixelPngBase64, 'base64'),
    });

    const details = page.getByText(/show text read from the bag/i);
    await expect(details).toBeVisible({ timeout: 20000 });
    await details.click();
    await expect(page.locator('details pre')).toBeVisible();
  });
});
