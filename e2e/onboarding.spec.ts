import { expect, test, type Page } from '@playwright/test';

/**
 * Seeds a single unrated coffee, which is the exact state the first hint is
 * gated on: something in the library, nothing scored yet.
 */
async function seedOneBean(page: Page) {
  await page.goto('/');
  await expect(
    page
      .getByRole('heading', { level: 2 })
      .or(page.getByRole('link', { name: /add your first coffee/i }))
      .first(),
  ).toBeVisible();

  await page.evaluate(async () => {
    async function openDb(): Promise<IDBDatabase> {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('coffee-app');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(new Error(String(request.error)));
        });
        if (db.objectStoreNames.contains('beans')) return db;
        db.close();
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('Dexie never created the beans store');
    }

    const db = await openDb();
    const tx = db.transaction('beans', 'readwrite');
    tx.objectStore('beans').put({
      id: 'hint-seed-1',
      schemaVersion: 1,
      name: 'Yirgacheffe',
      roaster: 'Blue Bottle',
      // photo-ocr, so the assisted-capture hint stays out of the way and each
      // assertion is about the hint it names.
      source: 'photo-ocr',
      isArchived: false,
      needsReview: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(null);
      tx.onerror = () => reject(new Error(String(tx.error)));
    });
    db.close();
  });
}

const FIRST_HINT = 'more ratings and recommendations switch on';

test.describe('Onboarding hints', () => {
  /**
   * The behaviour a hint system lives or dies by: dismissing has to stick. A
   * tip that returns on the next load is worse than no tip at all (#241).
   */
  test('a dismissed home hint stays dismissed across a reload', async ({ page }) => {
    await seedOneBean(page);
    await page.goto('/');

    await expect(page.getByText(FIRST_HINT)).toBeVisible();
    await page.getByRole('button', { name: /^Dismiss:/ }).click();
    await expect(page.getByText(FIRST_HINT)).toBeHidden();

    await page.reload();
    await expect(page.getByText(FIRST_HINT)).toBeHidden();
  });

  test('settings can bring dismissed hints back', async ({ page }) => {
    await seedOneBean(page);
    await page.goto('/');
    await page.getByRole('button', { name: /^Dismiss:/ }).click();
    await expect(page.getByText(FIRST_HINT)).toBeHidden();

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Show hints again' }).click();
    await expect(page.getByText('Hints restored', { exact: false })).toBeVisible();

    await page.goto('/');
    await expect(page.getByText(FIRST_HINT)).toBeVisible();
  });
});
