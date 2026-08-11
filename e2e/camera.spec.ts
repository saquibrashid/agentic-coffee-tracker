import { test, expect } from '@playwright/test';

/**
 * The in-app camera against a real browser (issue #145).
 *
 * The unit tests mock `getUserMedia`, the canvas and the video element, which
 * means they cannot catch the things most likely to actually break here: a
 * stream that never attaches to `srcObject`, autoplay being refused, or a
 * canvas that produces a blank frame. Chromium's fake capture device exercises
 * all three for real.
 */
test.describe('In-app camera', () => {
  // Chromium-only: the fake device flags in playwright.config.ts do not exist
  // in WebKit, so there is no camera to open on the mobile-safari project.
  test.skip(({ browserName }) => browserName !== 'chromium', 'Needs Chromium fake capture device.');

  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['camera']);
  });

  test('takes a photo and lands on the confirmation form', async ({ page }) => {
    await page.goto('/add');

    await page.getByRole('button', { name: /take a photo/i }).click();

    // The shutter stays disabled until a frame has actually arrived, so waiting
    // for it to enable is also the assertion that the stream is live.
    const shutter = page.getByRole('button', { name: /^take photo$/i });
    await expect(shutter).toBeEnabled({ timeout: 15000 });
    await shutter.click();

    // Same destination as the upload path: the frame was persisted and sent
    // through OCR, which falls back to local mocks with no BFF in CI.
    await expect(page.getByLabel(/roaster/i)).toBeVisible({ timeout: 20000 });
  });

  test('leaves no camera running after a capture', async ({ page }) => {
    await page.goto('/add');
    await page.getByRole('button', { name: /take a photo/i }).click();

    const shutter = page.getByRole('button', { name: /^take photo$/i });
    await expect(shutter).toBeEnabled({ timeout: 15000 });
    await shutter.click();
    await expect(page.getByLabel(/roaster/i)).toBeVisible({ timeout: 20000 });

    // A live track left behind is what keeps the recording light on after the
    // user has moved on.
    const live = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll('video'));
      return videos.some((video) => {
        const stream = video.srcObject as MediaStream | null;
        return !!stream?.getTracks().some((track) => track.readyState === 'live');
      });
    });
    expect(live).toBe(false);
  });

  test('backs out cleanly when the user cancels', async ({ page }) => {
    await page.goto('/add');
    await page.getByRole('button', { name: /take a photo/i }).click();
    await expect(page.getByRole('button', { name: /^take photo$/i })).toBeEnabled({
      timeout: 15000,
    });

    await page.getByRole('button', { name: /cancel/i }).click();

    await expect(page.getByRole('button', { name: /take a photo/i })).toBeVisible();
    await expect(page.locator('input[type="file"]')).toBeVisible();
  });

  test('still lets an existing photo be chosen', async ({ page }) => {
    // `capture="environment"` used to remove the photo library option on iOS.
    // The file input must remain a genuine "choose a file" control.
    await page.goto('/add');

    await expect(page.locator('input[type="file"]')).not.toHaveAttribute('capture');
  });
});
