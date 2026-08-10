import { test, expect, type Page } from '@playwright/test';

/**
 * Seeds beans directly into IndexedDB so the library can be exercised without
 * driving the whole capture pipeline once per fixture.
 */
async function seedBeans(page: Page) {
  await page.goto('/');
  // The app owns the schema, so wait for its first render to prove Dexie has
  // finished creating the object stores before writing into them.
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
        if (db.objectStoreNames.contains('beans')) return db;
        db.close();
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('Dexie never created the beans store');
    }

    const db = await openDb();
    const now = new Date().toISOString();
    const beans = [
      {
        id: 'seed-1',
        name: 'Yirgacheffe',
        roaster: 'Blue Bottle',
        createdAt: '2026-03-01T00:00:00.000Z',
      },
      { id: 'seed-2', name: 'Huila', roaster: 'Onyx', createdAt: '2026-02-01T00:00:00.000Z' },
      {
        id: 'seed-3',
        name: 'Kirinyaga',
        roaster: 'Tim Wendelboe',
        createdAt: '2026-01-05T00:00:00.000Z',
      },
      {
        id: 'seed-4',
        name: 'Sidamo',
        roaster: 'Counter Culture',
        createdAt: '2026-01-04T00:00:00.000Z',
      },
      { id: 'seed-5', name: 'Antigua', roaster: 'Verve', createdAt: '2026-01-03T00:00:00.000Z' },
      { id: 'seed-6', name: 'Gesha', roaster: 'Ceremony', createdAt: '2026-01-02T00:00:00.000Z' },
      {
        id: 'seed-7',
        name: 'Buried Treasure',
        roaster: 'Sey',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const tx = db.transaction('beans', 'readwrite');
    const store = tx.objectStore('beans');
    for (const bean of beans) {
      store.put({
        ...bean,
        schemaVersion: 1,
        source: 'manual',
        isArchived: false,
        needsReview: false,
        updatedAt: now,
      });
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(null);
      tx.onerror = () => reject(new Error(String(tx.error)));
    });
    db.close();
  });
}

test.describe('Bean library', () => {
  test.beforeEach(async ({ page }) => {
    await seedBeans(page);
  });

  test('reaches beans that Home does not show, and opens one', async ({ page }) => {
    await page.goto('/');

    // Home caps at six, so the seventh bean is the whole point of this route.
    await expect(page.getByText('Buried Treasure')).toHaveCount(0);

    await page.getByRole('link', { name: /view all 7 beans/i }).click();
    await expect(page).toHaveURL(/\/beans$/);
    await expect(page.getByText('Buried Treasure')).toBeVisible();

    await page.getByText('Buried Treasure').click();
    await expect(page).toHaveURL(/\/beans\/seed-7/);
  });

  test('search narrows the list and the empty state offers a way back', async ({ page }) => {
    await page.goto('/beans');
    // Scoped to the bean list; the primary nav is also made of list items.
    const rows = page.getByRole('list', { name: 'Beans' }).getByRole('listitem');
    const search = page.getByLabel('Search', { exact: true });

    await search.fill('onyx');
    await expect(rows).toHaveCount(1);
    await expect(page.getByText('Huila')).toBeVisible();

    await search.fill('nothing matches this');
    await expect(page.getByText(/no beans match your filters/i)).toBeVisible();

    await page
      .getByRole('button', { name: /clear filters/i })
      .first()
      .click();
    await expect(rows).toHaveCount(7);
  });

  test('filters are collapsed until asked for, then narrow the list', async ({ page }) => {
    await page.goto('/beans');
    const rows = page.getByRole('list', { name: 'Beans' }).getByRole('listitem');
    const roasterGroup = page.getByRole('group', { name: 'Roaster' });

    // The point of the disclosure: the list, not six controls, is above the fold.
    await expect(roasterGroup).toBeHidden();

    await page.getByRole('search', { name: 'Filter beans' }).getByText('Filters').click();
    await expect(roasterGroup).toBeVisible();

    // The seeds carry no origin or varietal, so those groups must not appear at
    // all rather than render as empty boxes the user cannot act on.
    await expect(page.getByRole('group', { name: 'Origin' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Varietal' })).toHaveCount(0);

    await roasterGroup.getByText('Onyx').click();
    await expect(rows).toHaveCount(1);
    await expect(page.getByText('Huila')).toBeVisible();

    // Multi-select is a union, not an intersection: picking a second roaster
    // must widen the list, which is the opposite of what a second select does.
    await roasterGroup.getByText('Verve').click();
    await expect(rows).toHaveCount(2);

    await page.getByRole('button', { name: /clear filters/i }).click();
    await expect(rows).toHaveCount(7);
    await expect(roasterGroup.getByRole('checkbox', { name: /^Onyx/ })).not.toBeChecked();
  });

  test('sorting by name reorders the list', async ({ page }) => {
    await page.goto('/beans');
    await page.getByLabel(/sort by/i).selectOption('name');
    const first = page.getByRole('list', { name: 'Beans' }).getByRole('listitem').first();
    await expect(first).toContainText('Antigua');
  });

  test('removes a selected bean after confirmation', async ({ page }) => {
    await page.goto('/beans');
    const rows = page.getByRole('list', { name: 'Beans' }).getByRole('listitem');
    await expect(rows).toHaveCount(7);

    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByRole('checkbox', { name: /select huila/i }).check();
    await expect(page.getByText('1 selected')).toBeVisible();

    await page.getByRole('button', { name: /remove/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/permanently removes 1 coffee/i);
    await dialog.getByRole('button', { name: 'Remove' }).click();

    await expect(rows).toHaveCount(6);
    await expect(page.getByText('Huila')).toBeHidden();
    // The removal must survive a reload, or it only ever happened in React state.
    await page.reload();
    await expect(page.getByRole('list', { name: 'Beans' }).getByRole('listitem')).toHaveCount(6);
  });

  test('cancelling the confirmation keeps the bean', async ({ page }) => {
    await page.goto('/beans');
    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByRole('checkbox', { name: /select huila/i }).check();
    await page.getByRole('button', { name: /remove/i }).click();

    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('list', { name: 'Beans' }).getByRole('listitem')).toHaveCount(7);
    await expect(page.getByText('Huila')).toBeVisible();
  });

  test('removes several beans at once', async ({ page }) => {
    await page.goto('/beans');
    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByRole('checkbox', { name: /select huila/i }).check();
    await page.getByRole('checkbox', { name: /select gesha/i }).check();
    await expect(page.getByText('2 selected')).toBeVisible();

    await page
      .getByRole('button', { name: /^remove$/i })
      .first()
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();

    await expect(page.getByRole('list', { name: 'Beans' }).getByRole('listitem')).toHaveCount(5);
  });

  test('selection mode does not navigate away when a row is tapped', async ({ page }) => {
    await page.goto('/beans');
    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByText('Huila').click();

    await expect(page).toHaveURL(/\/beans$/);
    await expect(page.getByText('1 selected')).toBeVisible();
  });
});
