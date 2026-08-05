import { test, expect, type Page } from '@playwright/test';

/**
 * The BFF is not running in e2e, so both enrichment endpoints are stubbed at the
 * network boundary with the same shapes the mock BFF returns. That keeps this
 * test honest about the contract without needing credentials or a live server.
 */
async function stubEnrichmentApi(page: Page) {
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
            { country: 'Ethiopia', region: 'Yirgacheffe', farm: null, producer: null, percentage: null },
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

  test('applies only the fields the user accepts, preserving their own values', async ({ page }) => {
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
});
