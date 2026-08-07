import { test, expect, type Page } from '@playwright/test';

/**
 * Seeds one bean with two ratings straight into IndexedDB, so the edit and
 * delete paths can be exercised without driving capture and rating first.
 */
async function seedBeanWithRatings(page: Page) {
  await page.goto('/');
  await expect(
    page
      .getByRole('heading', { level: 2 })
      .or(page.getByText(/welcome to your coffee log/i))
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
        if (db.objectStoreNames.contains('beans') && db.objectStoreNames.contains('ratings')) {
          return db;
        }
        db.close();
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('Dexie never created the stores');
    }

    const db = await openDb();
    const now = new Date().toISOString();

    const tx = db.transaction(['beans', 'ratings'], 'readwrite');
    tx.objectStore('beans').put({
      id: 'rated-1',
      schemaVersion: 1,
      name: 'Yirgacheffe',
      roaster: 'Blue Bottle',
      source: 'manual',
      isArchived: false,
      needsReview: false,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: now,
    });
    tx.objectStore('ratings').put({
      id: 'rating-1',
      schemaVersion: 2,
      beanId: 'rated-1',
      score: 6,
      brewType: 'drip',
      notes: 'a bit flat',
      ratedAt: '2026-03-02T00:00:00.000Z',
      createdAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });
    tx.objectStore('ratings').put({
      id: 'rating-2',
      schemaVersion: 2,
      beanId: 'rated-1',
      score: 10,
      brewType: 'espresso',
      ratedAt: '2026-03-03T00:00:00.000Z',
      createdAt: '2026-03-03T00:00:00.000Z',
      updatedAt: '2026-03-03T00:00:00.000Z',
    });

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(null);
      tx.onerror = () => reject(new Error(String(tx.error)));
    });
    db.close();
  });

  await page.goto('/beans/rated-1');
  await expect(page.getByRole('heading', { name: 'Yirgacheffe' })).toBeVisible();
}

test.describe('Ratings on a bean', () => {
  test.beforeEach(async ({ page }) => {
    await seedBeanWithRatings(page);
  });

  test('edits a rating in place', async ({ page }) => {
    await page
      .getByRole('listitem')
      .filter({ hasText: '6/10' })
      .getByRole('button', { name: /edit rating/i })
      .click();

    // The row is now a form; scope every control to it so the add-rating form
    // below cannot be driven by mistake.
    const form = page.getByRole('form', { name: 'Edit rating' });
    await form.getByLabel('Score').selectOption('8');
    await form.getByLabel('Brew type').selectOption('latte');
    await form.getByLabel('Tasting notes').fill('better with milk');
    await form.getByRole('button', { name: /save rating/i }).click();

    const updated = page.getByRole('listitem').filter({ hasText: '8/10' });
    await expect(updated).toContainText('Latte');
    await expect(updated).toContainText('better with milk');
    await expect(page.getByRole('listitem').filter({ hasText: '6/10' })).toHaveCount(0);
  });

  test('an edit survives a reload', async ({ page }) => {
    await page
      .getByRole('listitem')
      .filter({ hasText: '6/10' })
      .getByRole('button', { name: /edit rating/i })
      .click();

    const form = page.getByRole('form', { name: 'Edit rating' });
    await form.getByLabel('Score').selectOption('4');
    await form.getByRole('button', { name: /save rating/i }).click();

    await expect(page.getByRole('listitem').filter({ hasText: '4/10' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('listitem').filter({ hasText: '4/10' })).toBeVisible();
  });

  test('cancelling an edit leaves the rating untouched', async ({ page }) => {
    await page
      .getByRole('listitem')
      .filter({ hasText: '6/10' })
      .getByRole('button', { name: /edit rating/i })
      .click();

    const form = page.getByRole('form', { name: 'Edit rating' });
    await form.getByLabel('Score').selectOption('2');
    await form.getByRole('button', { name: /^cancel$/i }).click();

    await expect(page.getByRole('listitem').filter({ hasText: '6/10' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: '2/10' })).toHaveCount(0);
  });

  test('deletes a single rating and leaves the other', async ({ page }) => {
    await page
      .getByRole('listitem')
      .filter({ hasText: '6/10' })
      .getByRole('button', { name: /delete rating/i })
      .click();

    await expect(page.getByRole('heading', { name: /remove this rating\?/i })).toBeVisible();
    await page.getByRole('button', { name: /^remove$/i }).click();

    await expect(page.getByRole('listitem').filter({ hasText: '6/10' })).toHaveCount(0);
    await expect(page.getByRole('listitem').filter({ hasText: '10/10' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('listitem').filter({ hasText: '6/10' })).toHaveCount(0);
  });

  test('cancelling the delete keeps the rating', async ({ page }) => {
    await page
      .getByRole('listitem')
      .filter({ hasText: '6/10' })
      .getByRole('button', { name: /delete rating/i })
      .click();
    await page.getByRole('button', { name: /^cancel$/i }).click();

    await expect(page.getByRole('listitem').filter({ hasText: '6/10' })).toBeVisible();
  });

  test('removes the whole coffee from its detail page and returns to the library', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /remove coffee/i }).click();

    // The confirmation names the ratings that go with it, which is the part the
    // user cannot otherwise see.
    await expect(page.getByRole('heading', { name: /remove this coffee\?/i })).toBeVisible();
    await expect(page.getByText(/2 ratings/i)).toBeVisible();

    await page.getByRole('button', { name: /^remove$/i }).click();

    await expect(page).toHaveURL(/\/beans$/);
    await expect(page.getByText('Yirgacheffe')).toHaveCount(0);
  });
});
