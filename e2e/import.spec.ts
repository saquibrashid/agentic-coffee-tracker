import { test, expect, type Page } from '@playwright/test';

/**
 * Drives the real Settings import flow: pick a file, read the preview, confirm,
 * then check the coffees and ratings actually landed in the library.
 *
 * The unit tests cover the parsing rules; this covers the part they cannot —
 * that the file input, the plan preview and the Dexie write are wired together.
 */

const CSV = [
  'roaster,coffee,score,brew,date,notes',
  'Onyx Coffee Lab,Southern Weather,4,espresso,2025-03-14,"bright, juicy"',
  'Onyx Coffee Lab,Southern Weather,5,pour-over,2025-03-15,',
  'Anchorhead Coffee,Bali Kintamani,5,espresso,2025-03-16,',
  'Broken Row,No Score,,espresso,2025-03-17,',
].join('\n');

async function gotoSettings(page: Page) {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Import' })).toBeVisible();
}

async function chooseCsv(page: Page, body = CSV, name = 'history.csv') {
  await page.setInputFiles('#import-file', {
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(body, 'utf-8'),
  });
}

test.describe('bulk import', () => {
  test('previews a CSV without writing anything until confirmed', async ({ page }) => {
    await gotoSettings(page);
    await chooseCsv(page);

    await expect(page.getByText('3 ratings will be added')).toBeVisible();
    await expect(page.getByText('2 new coffees will be created')).toBeVisible();
    await expect(page.getByText(/could not import \(1\)/i)).toBeVisible();

    // Cancelling must leave the library untouched.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.goto('/beans');
    await expect(page.getByText('Southern Weather')).toHaveCount(0);
  });

  test('imports the ratings and shows them in the library', async ({ page }) => {
    await gotoSettings(page);
    await chooseCsv(page);
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    await expect(page.getByRole('status')).toContainText('Imported 3 ratings');

    await page.goto('/beans');
    await expect(page.getByText('Southern Weather')).toBeVisible();
    await expect(page.getByText('Bali Kintamani')).toBeVisible();
  });

  test('re-importing the same file adds nothing', async ({ page }) => {
    await gotoSettings(page);
    await chooseCsv(page);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Imported 3 ratings');

    await chooseCsv(page);
    await expect(page.getByText('0 ratings will be added')).toBeVisible();
    await expect(page.getByText(/skipped as already recorded \(3\)/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  });

  test('rejects a file with no usable columns', async ({ page }) => {
    await gotoSettings(page);
    await chooseCsv(page, 'when,where\n2025-01-01,home', 'wrong.csv');

    await expect(page.getByRole('alert')).toContainText('Missing required column');
  });

  test('restores a JSON export', async ({ page }) => {
    const backup = JSON.stringify({
      exportedAt: '2025-03-14T00:00:00.000Z',
      beans: [
        {
          id: 'restored-1',
          schemaVersion: 1,
          roaster: 'Sey Coffee',
          name: 'Restored Bean',
          source: 'manual',
          isArchived: false,
          needsReview: false,
          createdAt: '2025-03-01T00:00:00.000Z',
          updatedAt: '2025-03-01T00:00:00.000Z',
        },
      ],
      ratings: [
        {
          id: 'restored-r1',
          schemaVersion: 1,
          beanId: 'restored-1',
          score: 5,
          brewType: 'pour-over',
          ratedAt: '2025-03-02T00:00:00.000Z',
          createdAt: '2025-03-02T00:00:00.000Z',
          updatedAt: '2025-03-02T00:00:00.000Z',
        },
      ],
    });

    await gotoSettings(page);
    await page.setInputFiles('#import-file', {
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backup, 'utf-8'),
    });

    await expect(page.getByText(/1.*coffees.*1.*ratings/)).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Restored 1 coffees');

    await page.goto('/beans');
    await expect(page.getByText('Restored Bean')).toBeVisible();
  });
});
