import { test, expect, type Page } from '@playwright/test';

/**
 * Proves the shipped Content Security Policy does not break the app.
 *
 * This runs against `vite preview` serving a production build with the exact
 * header from `dist/staticwebapp.config.json` — see `playwright.csp.config.ts`
 * for why the dev-server suite cannot do this job.
 *
 * A CSP failure is not loud. The browser blocks one resource, logs to a console
 * nobody is watching, and the app keeps running with a feature quietly missing.
 * So violations are collected as structured events and asserted on directly,
 * rather than inferred from whether the page still looks right.
 */

interface Violation {
  directive: string;
  blocked: string;
}

declare global {
  interface Window {
    __cspViolations: Violation[];
  }
}

/**
 * Records violations from before the first line of app code runs.
 *
 * The inline theme script executes during head parsing, so a listener attached
 * any later would miss precisely the violation most likely to occur.
 */
async function collectViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
      });
    });
  });
}

async function violations(page: Page): Promise<Violation[]> {
  return page.evaluate(() => window.__cspViolations ?? []);
}

/**
 * Writes a bean and some ratings straight into IndexedDB.
 *
 * An empty store renders empty states, so without this the routes would load
 * their chunks and then draw nothing — the chart in particular emits no SVG at
 * all, and the policy would never meet the code most able to violate it.
 */
async function seedLibrary(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading').first()).toBeVisible();

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
      id: 'csp-bean',
      name: 'Yirgacheffe',
      roaster: 'Blue Bottle',
      // A data-URL thumbnail, so the library actually paints an `img-src data:`
      // image rather than a placeholder.
      thumbnailDataUrl:
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      schemaVersion: 1,
      source: 'manual',
      isArchived: false,
      needsReview: false,
      createdAt: now,
      updatedAt: now,
    });

    const ratings = tx.objectStore('ratings');
    for (const [index, score] of [8, 6, 3].entries()) {
      ratings.put({
        id: `csp-rating-${index}`,
        beanId: 'csp-bean',
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

test.describe('Content Security Policy', () => {
  test.beforeEach(async ({ page }) => {
    await collectViolations(page);
  });

  test('is actually served', async ({ page }) => {
    // Without this, every other assertion in this file would still pass if the
    // build plugin silently stopped emitting the header.
    const response = await page.goto('/');
    const csp = response?.headers()['content-security-policy'];

    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");

    // The hash is the part most likely to go stale, and a policy that reached
    // `'unsafe-inline'` for scripts would defeat the point of having one.
    expect(csp).toMatch(/script-src [^;]*'sha256-/);
    expect(csp).not.toMatch(/script-src [^;]*'unsafe-inline'/);
  });

  test('allows the inline theme script to run before first paint', async ({ page }) => {
    // The whole reason that script is inline. If its hash is wrong the script is
    // blocked, the class is never applied, and dark-mode users get a white
    // flash on every load — a regression no other test would notice.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    await expect(page.locator('html')).toHaveClass(/dark/);
    expect(await violations(page)).toEqual([]);
  });

  test('renders every route without a violation', async ({ page }) => {
    // Seeded first, because an empty store renders empty states: the analytics
    // chart draws no SVG, the library lists nothing, and the routes most likely
    // to trip the policy would never execute the code that trips it.
    await seedLibrary(page);

    // Each route also pulls a different lazy chunk, and `worker-src`/
    // `connect-src` problems only appear once the code that needs them loads.
    for (const route of ['/', '/beans', '/add', '/analytics', '/for-you', '/settings']) {
      await page.goto(route);
      await expect(page.getByRole('heading').first()).toBeVisible();

      expect(await violations(page), `violation on ${route}`).toEqual([]);
    }
  });

  test('renders the chart with data without a violation', async ({ page }) => {
    // recharts is the heaviest renderer in the app and the one that emits SVG
    // with computed presentation. Asserting bars exist proves the policy was
    // exercised against real drawing rather than an empty state.
    await seedLibrary(page);
    await page.goto('/analytics');

    await expect(page.locator('.recharts-bar-rectangle path').first()).toBeAttached();
    expect(await violations(page)).toEqual([]);
  });

  test('registers the service worker', async ({ page }) => {
    // Workbox registers from the app origin, which `worker-src 'self'` has to
    // permit. A blocked registration costs the app its offline capability
    // without changing anything visible on screen.
    await page.goto('/');

    await expect
      .poll(async () => page.evaluate(() => navigator.serviceWorker.controller !== null), {
        message: 'the service worker should take control',
        timeout: 15_000,
      })
      .toBe(true);

    expect(await violations(page)).toEqual([]);
  });

  test('renders images stored as data and blob URLs', async ({ page }) => {
    // Thumbnails are data URLs on the bean record and full photos come out of
    // IndexedDB through `URL.createObjectURL`. Both are blocked by a default
    // `img-src 'self'`, and a blocked image renders as empty space rather than
    // as an error.
    await page.goto('/');
    await expect(page.getByRole('heading').first()).toBeVisible();

    const rendered = await page.evaluate(async () => {
      const pixel =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

      async function loads(src: string): Promise<boolean> {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = src;
        });
      }

      // Decoded with `atob`, matching `dataUrlToBlob`, rather than with
      // `fetch(dataUrl)`. The obvious `fetch` version fails here — a data URL
      // is a fetch that `connect-src 'self'` blocks — which is worth knowing:
      // the policy would break that idiom if app code ever adopted it.
      const binary = atob(pixel.split(',')[1] ?? '');
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }));

      const result = { data: await loads(pixel), blob: await loads(blobUrl) };
      URL.revokeObjectURL(blobUrl);
      return result;
    });

    expect(rendered).toEqual({ data: true, blob: true });
    expect(await violations(page)).toEqual([]);
  });
});
