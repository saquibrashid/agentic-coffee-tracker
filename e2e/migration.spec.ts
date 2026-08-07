import { test, expect } from '@playwright/test';

/**
 * Seeds a *v1* database with old-scale scores, then loads the app and checks the
 * Dexie upgrade converted them. This is the one path unit tests cannot fully
 * prove: it exercises a real IndexedDB version transition in a real browser.
 */
test('migrates an existing 1-5 history to the 1-10 scale on first load', async ({ page }) => {
  // robots.txt is same-origin but loads no app code, so nothing holds the
  // database open while it is replaced with a v1 one.
  await page.goto('/robots.txt');

  await page.evaluate(async () => {
    // Close whatever the app opened so the version change is not blocked.
    const wipe = indexedDB.deleteDatabase('coffee-app');
    await new Promise((resolve) => {
      wipe.onsuccess = resolve;
      wipe.onerror = resolve;
      wipe.onblocked = resolve;
    });

    await new Promise<void>((resolve, reject) => {
      // Dexie maps its schema version N onto IndexedDB version N*10, so a
      // Dexie v1 database is IndexedDB version 10.
      const request = indexedDB.open('coffee-app', 10);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('beans', { keyPath: 'id' });
        db.createObjectStore('ratings', { keyPath: 'id' });
        db.createObjectStore('photos', { keyPath: 'id' });
        db.createObjectStore('ocrResults', { keyPath: 'id' });
        db.createObjectStore('preferences', { keyPath: 'id' });
        db.createObjectStore('pendingAiTasks', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['beans', 'ratings'], 'readwrite');
        tx.objectStore('beans').put({
          id: 'legacy-1',
          schemaVersion: 1,
          name: 'Legacy Lot',
          roaster: 'Old Scale Roasters',
          source: 'manual',
          isArchived: false,
          needsReview: false,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        });
        tx.objectStore('ratings').put({
          id: 'legacy-r1',
          schemaVersion: 1,
          beanId: 'legacy-1',
          score: 4,
          brewType: 'espresso',
          ratedAt: '2025-01-02T00:00:00.000Z',
          createdAt: '2025-01-02T00:00:00.000Z',
          updatedAt: '2025-01-02T00:00:00.000Z',
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(new Error(String(tx.error)));
      };
      request.onerror = () => reject(new Error(String(request.error)));
    });
  });

  // Reload so the app opens the seeded database and runs the v2 upgrade.
  await page.goto('/beans/legacy-1');

  await expect(page.getByRole('heading', { name: 'Legacy Lot' })).toBeVisible();
  // 4 on the old scale is a good cup, so it must read 8/10 — not 4/10.
  await expect(page.getByText('8/10')).toBeVisible();
});
