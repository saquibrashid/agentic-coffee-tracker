/**
 * Does headless WebKit still refuse to store a Blob in IndexedDB?
 *
 * Three e2e tests skip WebKit because of this (see e2e/add-coffee.spec.ts and
 * e2e/enrichment.spec.ts). Real iOS Safari stores photos fine — that was
 * verified by hand on a device in issue #100 — so the skips exist purely
 * because of the headless automation build, not because of an app defect.
 *
 * Run this after a Playwright upgrade to check whether the limitation has
 * been fixed upstream. If the blob line reports "ok", delete the three skips
 * and let those tests run on WebKit for real.
 *
 *   node scripts/webkit-blob-probe.mjs
 *
 * Last run: WebKit 26.5 — still failing.
 */
import { webkit } from '@playwright/test';

const browser = await webkit.launch();
const page = await browser.newPage();

// IndexedDB refuses to open on about:blank (opaque origin), so serve a stub
// page on a real origin.
await page.route('https://probe.test/**', (route) =>
  route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>probe</body></html>' }),
);
await page.goto('https://probe.test/');

const result = await page.evaluate(async () => {
  const open = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open('probe', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error(`open: ${req.error?.name}`));
    });

  const put = (db, record) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite');
      let failure = null;
      const req = tx.objectStore('photos').add(record);
      req.onerror = () => {
        failure = `${req.error?.name}: ${req.error?.message}`;
      };
      tx.oncomplete = () => resolve('ok');
      tx.onabort = () => reject(new Error(failure ?? `abort: ${tx.error?.name}`));
      tx.onerror = () => reject(new Error(failure ?? `error: ${tx.error?.name}`));
    });

  const out = {};
  const db = await open();

  // Store a plain record first, so a Blob failure clearly points at Blob
  // handling rather than at IndexedDB being unavailable altogether.
  try {
    out.plain = await put(db, { id: 1, text: 'hello' });
  } catch (err) {
    out.plain = `FAILED ${err.message}`;
  }

  try {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    await put(db, { id: 2, blob });
    const back = await new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readonly');
      const req = tx.objectStore('photos').get(2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('read failed'));
    });
    out.blob = `ok, read back size=${back?.blob?.size} type=${back?.blob?.type}`;
  } catch (err) {
    out.blob = `FAILED ${err.message}`;
  }

  return out;
});

console.log(`webkit ${browser.version()}`);
console.log(`  plain value: ${result.plain}`);
console.log(`  blob value : ${result.blob}`);
await browser.close();
