import { test, expect, type BrowserContext, type Page } from '@playwright/test';

import { FakeSyncService } from './fakeSyncService';

/**
 * The two-device test. `specs/sync.md` → Testing says it plainly: "the two-context
 * E2E test is the one that actually proves the feature. Prioritise it over
 * breadth of unit coverage."
 *
 * Everything below it in the stack already has unit coverage — merge rules,
 * outbox coalescing, seq assignment, backoff. What none of them can show is the
 * only claim a user actually cares about: that a change made on one device
 * turns up on another, and that two devices that disagree end up agreeing.
 *
 * Two browser contexts are two devices in the way that matters here. Each has
 * its own IndexedDB, its own Web Locks namespace and its own engine instance;
 * the only thing they share is the fake service, which is exactly the topology
 * of two phones and one Cosmos partition.
 */

const USER = { userId: 'user-a', identityProvider: 'aad', userDetails: 'coffee@example.com' };

/**
 * Whether the shared service is currently reachable.
 *
 * `context.setOffline(true)` alone is not enough: it emulates the *network*,
 * and a `context.route` handler fulfils without ever reaching it, so a push
 * would still succeed on a device the test believes is offline. That gap ate a
 * run — the assertion that nothing reached the server failed because everything
 * had. The flag makes the fake refuse, which is what the client would actually
 * see; `setOffline` is still used alongside it, because that is what moves
 * `navigator.onLine`, and the engine reads it to distinguish "offline" from
 * "error".
 */
let reachable = true;

/** Wires one context up as a device: signed in, and talking to `service`. */
async function attachDevice(context: BrowserContext, service: FakeSyncService): Promise<Page> {
  await context.route('**/.auth/me', async (route) => {
    await route.fulfill({ json: { clientPrincipal: USER } });
  });

  await context.route('**/api/sync/pull', async (route) => {
    if (!reachable) return route.abort('internetdisconnected');
    service.calls.push('pull');
    const body = route.request().postDataJSON() as { cursor?: number; limit?: number };
    await route.fulfill({ json: service.pull(body.cursor ?? 0, body.limit) });
  });

  await context.route('**/api/sync/push', async (route) => {
    if (!reachable) return route.abort('internetdisconnected');
    service.calls.push('push');
    const body = route.request().postDataJSON() as { deviceId: string; records: [] };
    await route.fulfill({ json: service.push(body.deviceId, body.records) });
  });

  // No photo bytes in these journeys, and an unrouted call would fall through to
  // the dev server and 404 into a sync error that masks the real assertion.
  await context.route('**/api/sync/photo/**', async (route) => {
    await route.fulfill({ status: 404, json: { error: 'no photo' } });
  });

  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return page;
}

/**
 * Writes a bean and its outbox entry, the way a mutation site does.
 *
 * Going through the capture UI would drive the AI pipeline once per fixture and
 * make the test about extraction rather than convergence. The outbox entry is
 * written explicitly because that is the contract every mutation site honours —
 * writing the record without it would be a bug, not a shortcut.
 */
async function writeBean(
  page: Page,
  bean: { id: string; name: string; roaster: string; updatedAt: string },
): Promise<void> {
  await page.evaluate(async (input) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('coffee-app');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(String(request.error)));
    });

    const tx = db.transaction(['beans', 'outbox'], 'readwrite');
    tx.objectStore('beans').put({
      id: input.id,
      name: input.name,
      roaster: input.roaster,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
      schemaVersion: 1,
    });
    tx.objectStore('outbox').put({
      id: `outbox-${input.id}`,
      type: 'bean',
      recordId: input.id,
      op: 'upsert',
      queuedAt: input.updatedAt,
      attempts: 0,
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error(String(tx.error)));
    });
    db.close();
  }, bean);
}

/** Queues a tombstone and removes the row, the way a delete site does. */
async function deleteBean(page: Page, id: string, deletedAt: string): Promise<void> {
  await page.evaluate(
    async (input) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('coffee-app');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error(String(request.error)));
      });

      const tx = db.transaction(['beans', 'outbox'], 'readwrite');
      tx.objectStore('beans').delete(input.id);
      tx.objectStore('outbox').put({
        id: `outbox-del-${input.id}`,
        type: 'bean',
        recordId: input.id,
        op: 'delete',
        queuedAt: input.deletedAt,
        // The tombstone's LWW clock, captured at delete time because the row is
        // already gone from its own table by then.
        deletedAt: input.deletedAt,
        attempts: 0,
      });

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error(String(tx.error)));
      });
      db.close();
    },
    { id, deletedAt },
  );
}

/**
 * Presses Sync now and waits for the cycle to settle.
 *
 * Deterministic on purpose. The periodic trigger is a five-minute timer and the
 * mutation trigger is debounced; waiting on either would make this test a timing
 * experiment.
 */
async function syncNow(page: Page): Promise<void> {
  await page.goto('/settings');
  await clickSync(page);
}

/**
 * The click alone, for callers already on `/settings`.
 *
 * Split out for the offline case: `page.goto` fails outright with no network,
 * so the page has to be loaded before the connection is cut. That is also the
 * honest simulation — a real user goes offline with the app already open.
 */
async function clickSync(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: /Sync now/i });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toBeEnabled({ timeout: 15_000 });
}

/**
 * Asserts a bean's presence in the library, by row.
 *
 * A locator rather than a snapshot of names, so Playwright retries while the
 * cycle's Dexie write lands. Reading the list once and comparing arrays made
 * this a race between the assertion and the merge.
 */
function beanRow(page: Page, name: string) {
  return page.locator('main li').filter({ hasText: name });
}

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/beans');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function expectBean(page: Page, name: string): Promise<void> {
  await openLibrary(page);
  await expect(beanRow(page, name)).toHaveCount(1);
}

async function expectNoBean(page: Page, name: string): Promise<void> {
  await openLibrary(page);
  await expect(beanRow(page, name)).toHaveCount(0);
}

/** Reads a bean's name straight from IndexedDB, for use while offline. */
async function localBeanName(page: Page, id: string): Promise<string | undefined> {
  return page.evaluate(async (beanId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('coffee-app');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(String(request.error)));
    });

    const bean = await new Promise<{ name?: string } | undefined>((resolve, reject) => {
      const request = db.transaction('beans').objectStore('beans').get(beanId);
      request.onsuccess = () => resolve(request.result as { name?: string } | undefined);
      request.onerror = () => reject(new Error(String(request.error)));
    });
    db.close();
    return bean?.name;
  }, id);
}

test.describe('two devices, one account', () => {
  let service: FakeSyncService;
  let deviceA: Page;
  let deviceB: Page;

  test.beforeEach(async ({ browser }) => {
    service = new FakeSyncService();
    reachable = true;
    // Separate contexts, so separate IndexedDB and separate engine instances.
    // Two pages in one context would share storage and prove nothing.
    deviceA = await attachDevice(await browser.newContext(), service);
    deviceB = await attachDevice(await browser.newContext(), service);
  });

  test.afterEach(async () => {
    await deviceA.context().close();
    await deviceB.context().close();
  });

  test('a bean created on A appears on B', async () => {
    await writeBean(deviceA, {
      id: 'bean-converge',
      name: 'Yirgacheffe',
      roaster: 'Anchorhead',
      updatedAt: '2026-03-01T00:00:00.000Z',
    });

    await syncNow(deviceA);
    expect(service.get('bean', 'bean-converge')?.payload).toMatchObject({ name: 'Yirgacheffe' });

    await syncNow(deviceB);
    await expectBean(deviceB, 'Yirgacheffe');
  });

  test('conflicting edits converge to one value on both devices', async () => {
    await writeBean(deviceA, {
      id: 'bean-conflict',
      name: 'Original',
      roaster: 'Anchorhead',
      updatedAt: '2026-03-01T00:00:00.000Z',
    });
    await syncNow(deviceA);
    await syncNow(deviceB);

    // Both devices now hold the record and edit it independently, offline from
    // each other's point of view. B's clock is later, so B must win — on both.
    await writeBean(deviceA, {
      id: 'bean-conflict',
      name: 'Edited on A',
      roaster: 'Anchorhead',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });
    await writeBean(deviceB, {
      id: 'bean-conflict',
      name: 'Edited on B',
      roaster: 'Anchorhead',
      updatedAt: '2026-03-03T00:00:00.000Z',
    });

    await syncNow(deviceA);
    await syncNow(deviceB);
    // A second cycle on A, to pull the winner it did not write.
    await syncNow(deviceA);

    expect(service.get('bean', 'bean-conflict')?.payload).toMatchObject({ name: 'Edited on B' });

    // The assertion that matters: not merely that the server picked one, but
    // that both devices show the same one. A server that converges while a
    // client keeps a stale local copy is the failure this test exists to catch.
    // The assertion that matters: not merely that the server picked one, but
    // that both devices show the same one. A server that converges while a
    // client keeps a stale local copy is the failure this test exists to catch.
    await expectBean(deviceA, 'Edited on B');
    await expectBean(deviceB, 'Edited on B');
    await expectNoBean(deviceA, 'Edited on A');
  });

  test('a delete on A propagates to B', async () => {
    await writeBean(deviceA, {
      id: 'bean-doomed',
      name: 'Temporary',
      roaster: 'Anchorhead',
      updatedAt: '2026-03-01T00:00:00.000Z',
    });
    await syncNow(deviceA);
    await syncNow(deviceB);
    await expectBean(deviceB, 'Temporary');

    await deleteBean(deviceA, 'bean-doomed', '2026-03-04T00:00:00.000Z');
    await syncNow(deviceA);
    await syncNow(deviceB);

    // A tombstone, not an absence: the record has to keep its identity and its
    // clock, or a device that still holds the row would re-create it.
    expect(service.get('bean', 'bean-doomed')).toMatchObject({ deleted: true, payload: null });
    await expectNoBean(deviceB, 'Temporary');
  });

  test('an older edit loses even when it arrives last', async () => {
    await writeBean(deviceA, {
      id: 'bean-late',
      name: 'Newer',
      roaster: 'Anchorhead',
      updatedAt: '2026-03-05T00:00:00.000Z',
    });
    await syncNow(deviceA);

    // B pushes a genuinely older version afterwards. Arrival order must not
    // decide the winner — only the clock may.
    await writeBean(deviceB, {
      id: 'bean-late',
      name: 'Older',
      roaster: 'Anchorhead',
      updatedAt: '2026-03-01T00:00:00.000Z',
    });
    await syncNow(deviceB);

    expect(service.get('bean', 'bean-late')?.payload).toMatchObject({ name: 'Newer' });

    // B must also drop its own losing copy rather than keeping it locally,
    // which would leave the two devices permanently disagreeing.
    await syncNow(deviceB);
    await expectBean(deviceB, 'Newer');
    await expectNoBean(deviceB, 'Older');
  });

  test('a change made offline converges once the device reconnects', async () => {
    await writeBean(deviceB, {
      id: 'bean-offline',
      name: 'Written offline',
      roaster: 'Anchorhead',
      updatedAt: '2026-03-06T00:00:00.000Z',
    });

    // Unreachable *before* navigating. The engine runs a cycle on start, so the
    // page load itself is a sync trigger — an earlier version of this test cut
    // the connection after navigating and the record was already gone.
    reachable = false;
    await deviceB.goto('/settings');
    await expect(deviceB.getByRole('button', { name: /Sync now/i })).toBeEnabled();
    await deviceB.context().setOffline(true);
    await clickSync(deviceB);

    // Nothing reached the server, and — crucially — the local write survived
    // the failed cycle. Losing it would make offline editing worthless.
    // Read the row straight out of IndexedDB rather than through the library
    // page: navigating needs a network, and the claim under test is about local
    // durability, not routing.
    expect(service.get('bean', 'bean-offline')).toBeUndefined();
    expect(await localBeanName(deviceB, 'bean-offline')).toBe('Written offline');

    await deviceB.context().setOffline(false);
    reachable = true;
    await clickSync(deviceB);
    expect(service.get('bean', 'bean-offline')?.payload).toMatchObject({
      name: 'Written offline',
    });

    await syncNow(deviceA);
    await expectBean(deviceA, 'Written offline');
  });
});

test.describe('a visitor who has not signed in', () => {
  test('never calls the sync API', async ({ browser }) => {
    // Auth being *available* is not the same as anyone being signed in, and the
    // engine used to conflate the two: it started on page load, called an
    // endpoint that requires a principal, and turned the inevitable 401 into a
    // permanent error state for someone who never asked to sync.
    const service = new FakeSyncService();
    reachable = true;
    const context = await browser.newContext();

    await context.route('**/.auth/me', async (route) => {
      await route.fulfill({ json: { clientPrincipal: null } });
    });
    // Deliberately still routed. If the engine calls anyway the request is
    // recorded and the test fails on the assertion rather than on a 404 from
    // the dev server, which would be a much vaguer signal.
    await context.route('**/api/sync/**', async (route) => {
      service.calls.push(route.request().url());
      await route.fulfill({ status: 401, json: { error: 'unauthorized' } });
    });

    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // The page-load cycle has had its chance by now; give the engine a further
    // beat so a late trigger cannot slip past the assertion.
    await page.waitForTimeout(1_000);

    expect(service.calls).toEqual([]);
    await context.close();
  });
});
