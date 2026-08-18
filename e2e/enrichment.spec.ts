import { test, expect, type Page } from '@playwright/test';

/**
 * The BFF is not running in e2e, so both enrichment endpoints are stubbed at the
 * network boundary with the same shapes the mock BFF returns. That keeps this
 * test honest about the contract without needing credentials or a live server.
 */

/** A real, decodable 1×1 PNG — the canvas resize pipeline needs actual pixels. */
const PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function stubEnrichmentApi(page: Page, options: { imageUrl?: string } = {}) {
  await page.route('**/api/search', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            url: 'https://mockroaster.example/geometry',
            title: 'Geometry — Mock Roaster',
            snippet: 'A bright, floral coffee.',
          },
        ],
      }),
    });
  });

  await page.route('**/api/scrape', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        extracted: { rawText: 'Mock Roaster Ethiopia Yirgacheffe washed light jasmine bergamot' },
        sourceUrl: 'https://mockroaster.example/geometry',
        ...(options.imageUrl ? { imageUrl: options.imageUrl } : {}),
      }),
    });
  });

  await page.route('**/api/image', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        dataUrl: PIXEL_PNG,
        contentType: 'image/png',
        byteSize: 68,
        sourceUrl: options.imageUrl ?? 'https://mockroaster.example/bag.png',
      }),
    });
  });

  await page.route('**/api/parse', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'mock',
        rawText: 'Mock Roaster Ethiopia Yirgacheffe washed light jasmine bergamot',
        parsed: {
          roaster: 'Mock Roaster',
          name: 'Yirgacheffe',
          origins: [
            {
              country: 'Ethiopia',
              region: 'Yirgacheffe',
              farm: null,
              producer: null,
              percentage: null,
            },
          ],
          process: 'washed',
          roastLevel: 'light',
          tastingNotes: ['jasmine', 'bergamot'],
          roastDate: null,
          varietals: [],
          elevationMeters: null,
          roasterDescription: null,
          confidence: 0.8,
        },
      }),
    });
  });
}

/**
 * Unfolds the enrichment panel on a bean page.
 *
 * It is collapsed by default now — it is a tool, not something you read — so
 * reaching its controls takes the same tap a person would make.
 */
async function openEnrichPanel(page: Page) {
  const panel = page.locator('details').filter({ hasText: 'Details from the web' });
  await expect(panel).toBeVisible({ timeout: 20000 });
  if (!(await panel.evaluate((el: HTMLDetailsElement) => el.open))) {
    await panel.locator('summary').click();
  }
  await expect(page.getByRole('button', { name: /find details on the web/i })).toBeVisible();
}

test.describe('Web enrichment', () => {
  test('imports a bean from a product URL and lands on the confirm form', async ({ page }) => {
    await stubEnrichmentApi(page);
    await page.goto('/add');

    await page.getByLabel(/import from a link/i).fill('https://mockroaster.example/geometry');
    await page.getByRole('button', { name: 'Import' }).click();

    // The URL path reuses the photo path's confirm step rather than a parallel form.
    const roaster = page.getByLabel(/roaster/i);
    await expect(roaster).toBeVisible({ timeout: 20000 });
    await expect(roaster).toHaveValue('Mock Roaster');
    await expect(page.getByLabel(/coffee name/i)).toHaveValue('Yirgacheffe');

    await page.getByRole('button', { name: /save coffee/i }).click();
    await expect(page).toHaveURL(/\/beans\//, { timeout: 15000 });
  });

  test('applies only the fields the user accepts, preserving their own values', async ({
    page,
  }) => {
    await stubEnrichmentApi(page);
    await page.goto('/add');
    await page.getByLabel(/import from a link/i).fill('https://mockroaster.example/geometry');
    await page.getByRole('button', { name: 'Import' }).click();

    // Give the bean a roaster of its own to conflict with, and clear the tasting
    // notes so enrichment has one safe fill and one conflict to offer.
    const roaster = page.getByLabel(/roaster/i);
    await expect(roaster).toBeVisible({ timeout: 20000 });
    await roaster.fill('My Local Roaster');
    await page.getByLabel(/tasting notes/i).fill('');
    await page.getByRole('button', { name: /save coffee/i }).click();
    await expect(page).toHaveURL(/\/beans\//, { timeout: 15000 });

    await openEnrichPanel(page);

    await page.getByRole('button', { name: /find details on the web/i }).click();
    await page.getByRole('button', { name: /use this page/i }).click();

    const changes = page.getByRole('list', { name: 'Proposed changes' });
    await expect(changes).toBeVisible({ timeout: 20000 });

    // The overwrite starts unchecked; the empty-field fill starts checked.
    const roasterRow = changes.getByRole('listitem').filter({ hasText: 'Roaster' });
    await expect(roasterRow.getByRole('checkbox')).not.toBeChecked();
    await expect(roasterRow).toContainText('Replaces your current value');

    const notesRow = changes.getByRole('listitem').filter({ hasText: 'Tasting notes' });
    await expect(notesRow.getByRole('checkbox')).toBeChecked();

    await page.getByRole('button', { name: /^Apply 1 change$/ }).click();
    await expect(page.getByText(/updated\. check the details above/i)).toBeVisible();

    // The unchecked conflict survived; only the accepted field was written.
    await expect(page.getByText('My Local Roaster')).toBeVisible();
    await expect(page.getByText('Mock Roaster', { exact: true })).toHaveCount(0);
  });

  test('an accepted overwrite does get applied', async ({ page }) => {
    await stubEnrichmentApi(page);
    await page.goto('/add');
    await page.getByLabel(/import from a link/i).fill('https://mockroaster.example/geometry');
    await page.getByRole('button', { name: 'Import' }).click();

    const roaster = page.getByLabel(/roaster/i);
    await expect(roaster).toBeVisible({ timeout: 20000 });
    await roaster.fill('My Local Roaster');
    await page.getByRole('button', { name: /save coffee/i }).click();
    await expect(page).toHaveURL(/\/beans\//, { timeout: 15000 });

    await openEnrichPanel(page);

    await page.getByRole('button', { name: /find details on the web/i }).click();
    await page.getByRole('button', { name: /use this page/i }).click();

    const changes = page.getByRole('list', { name: 'Proposed changes' });
    await expect(changes).toBeVisible({ timeout: 20000 });

    // Nothing is pre-selected here, so the defaults would write nothing at all.
    await expect(page.getByRole('button', { name: /^Apply 0 changes$/ })).toBeDisabled();

    await changes.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: /^Apply 1 change$/ }).click();
    await expect(page.getByText(/updated\. check the details above/i)).toBeVisible();
    await expect(page.getByText('Mock Roaster')).toBeVisible();
  });

  test('an imported coffee arrives with the product photo already attached', async ({
    page,
    browserName,
  }) => {
    // Headless WebKit cannot store a Blob in IndexedDB ("Error preparing
    // Blob/File data to be stored in object store"), which is the same reason
    // the bag-capture suite skips it. The photo path is identical for both.
    // Real iOS Safari handles this fine — verified by hand on a device in #100 —
    // so this is an automation limitation, not an app defect. Re-check with
    // `node scripts/webkit-blob-probe.mjs` after a Playwright upgrade.
    test.skip(browserName === 'webkit', 'Blob storage in IndexedDB is flaky in headless WebKit.');
    await stubEnrichmentApi(page, { imageUrl: 'https://mockroaster.example/bag.png' });
    await page.goto('/add');

    await page.getByLabel(/import from a link/i).fill('https://mockroaster.example/geometry');
    await page.getByRole('button', { name: 'Import' }).click();

    const roaster = page.getByLabel(/roaster/i);
    await expect(roaster).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /save coffee/i }).click();
    await expect(page).toHaveURL(/\/beans\//, { timeout: 15000 });

    // The library card is where a missing picture is most visible, so that is
    // where the fetched photo has to show up.
    await page.goto('/beans');
    const thumbnail = page.locator('img[src^="data:image/"]').first();
    await expect(thumbnail).toBeVisible({ timeout: 15000 });
  });

  test('offers the product photo as an opt-in change, and applies it', async ({
    page,
    browserName,
  }) => {
    // Same headless-WebKit Blob limitation as above; real iOS Safari is fine (#100).
    test.skip(browserName === 'webkit', 'Blob storage in IndexedDB is flaky in headless WebKit.');
    // No image on the import, so the saved coffee has no picture and the panel
    // has a real gap to offer.
    await stubEnrichmentApi(page);
    await page.goto('/add');
    await page.getByLabel(/import from a link/i).fill('https://mockroaster.example/geometry');
    await page.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByLabel(/roaster/i)).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /save coffee/i }).click();
    await expect(page).toHaveURL(/\/beans\//, { timeout: 15000 });

    // Now the lookup does find one.
    await stubEnrichmentApi(page, { imageUrl: 'https://mockroaster.example/bag.png' });
    await openEnrichPanel(page);
    await page.getByRole('button', { name: /find details on the web/i }).click();
    await page.getByRole('button', { name: /use this page/i }).click();

    const changes = page.getByRole('list', { name: 'Proposed changes' });
    await expect(changes).toBeVisible({ timeout: 20000 });

    const photoRow = changes.getByRole('listitem').filter({ hasText: 'Photo' });
    await expect(photoRow.getByRole('checkbox')).toBeChecked();

    await page.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
    await expect(page.getByText(/updated\. check the details above/i)).toBeVisible({
      timeout: 20000,
    });

    await page.goto('/beans');
    await expect(page.locator('img[src^="data:image/"]').first()).toBeVisible({ timeout: 15000 });
  });
});
