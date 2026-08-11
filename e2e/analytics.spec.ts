import { test, expect, type Page } from '@playwright/test';

/**
 * The analytics chart is the only place recharts is used, and nothing else in
 * the suite renders it with data — every other route reaches /analytics with an
 * empty store, where the chart draws no bars and a broken upgrade would look
 * identical to a healthy one. This test seeds ratings so the bars have to be
 * real SVG geometry, which is what a recharts major version bump can break.
 */
async function seedRatings(page: Page) {
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
      id: 'chart-bean',
      name: 'Yirgacheffe',
      roaster: 'Blue Bottle',
      schemaVersion: 1,
      source: 'manual',
      isArchived: false,
      needsReview: false,
      createdAt: now,
      updatedAt: now,
    });

    // Three distinct scores so the histogram has more than one non-zero bucket:
    // a chart that collapses everything into a single bar would still pass a
    // "some bar exists" assertion.
    const ratings = tx.objectStore('ratings');
    for (const [index, score] of [8, 8, 6, 3].entries()) {
      ratings.put({
        id: `chart-rating-${index}`,
        beanId: 'chart-bean',
        score,
        schemaVersion: 1,
        createdAt: now,
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

test.describe('Analytics chart', () => {
  test.beforeEach(async ({ page }) => {
    await seedRatings(page);
  });

  test('draws the score distribution as real bars', async ({ page }) => {
    await page.goto('/analytics');

    await expect(page.getByText('Ratings: 4')).toBeVisible();

    const chart = page.locator('svg.recharts-surface');
    await expect(chart).toBeVisible();

    // Three distinct scores were seeded, so three bars must have been drawn.
    // Recharts renders zero-height bars for empty buckets too, so filter to
    // the ones with actual height.
    const bars = page.locator('.recharts-bar-rectangle path');
    await expect(bars).toHaveCount(3);

    // A bar with no height is a chart that rendered its axes and gave up. This
    // is the assertion that a broken major version actually trips. Polled
    // because recharts animates bars up from zero height, and under a loaded
    // machine a single measurement can land mid-animation.
    await expect
      .poll(
        async () => {
          const heights = await bars.evaluateAll((nodes) =>
            nodes.map((node) => (node as SVGGraphicsElement).getBBox().height),
          );
          return Math.min(...heights);
        },
        { message: 'every seeded score should have drawn a bar with height' },
      )
      .toBeGreaterThan(0);

    // Axis ticks come from the data, not from static markup. Asserted by count
    // rather than visibility: Playwright reports an SVG <g> as hidden because
    // the group itself has no box, even when its children are painted.
    await expect(page.locator('.recharts-xAxis .recharts-cartesian-axis-tick')).not.toHaveCount(0);
  });
});
