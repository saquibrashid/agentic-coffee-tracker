import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { CoffeeDB } from './index';

/**
 * Builds a database at schema v1 — the shape that shipped before the rating
 * scale widened — so the upgrade runs against genuinely old data rather than
 * against records that were written by today's code.
 */
async function seedV1(name: string, scores: number[]): Promise<void> {
  const legacy = new Dexie(name);
  legacy.version(1).stores({
    beans: 'id, roaster, createdAt, isArchived, needsReview, *tastingNotes',
    ratings: 'id, beanId, ratedAt, brewType',
    photos: 'id, kind',
    ocrResults: 'id, photoId',
    preferences: 'id',
    pendingAiTasks: 'id, type, nextAttemptAt',
    meta: 'key',
  });
  await legacy.open();
  await legacy.table('ratings').bulkAdd(
    scores.map((score, i) => ({
      id: `r${i}`,
      schemaVersion: 1,
      beanId: 'b1',
      score,
      brewType: 'espresso',
      ratedAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })),
  );
  await legacy.table('preferences').add({ id: 'me', updatedAt: '2026-01-02T00:00:00.000Z' });
  legacy.close();
}

const opened: Dexie[] = [];

async function openUpgraded(name: string): Promise<CoffeeDB> {
  const db = new CoffeeDB(name);
  opened.push(db);
  await db.open();
  return db;
}

afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await db.delete();
  }
});

describe('v2 rating-scale migration', () => {
  it('doubles every stored score onto the 1-10 scale', async () => {
    await seedV1('migrate-doubles', [1, 2, 3, 4, 5]);

    const db = await openUpgraded('migrate-doubles');
    const scores = (await db.ratings.toArray()).map((r) => r.score).sort((a, b) => a - b);

    expect(scores).toEqual([2, 4, 6, 8, 10]);
  });

  it('stamps migrated ratings as v2 so they are never converted twice', async () => {
    await seedV1('migrate-stamps', [4]);

    const db = await openUpgraded('migrate-stamps');
    expect((await db.ratings.toArray()).every((r) => r.schemaVersion === 2)).toBe(true);

    // Re-opening runs no further upgrade, but the guard must hold regardless.
    db.close();
    await db.open();
    expect((await db.ratings.toArray())[0]?.score).toBe(8);
  });

  it('clears the cached preference profile, which was derived from old scores', async () => {
    await seedV1('migrate-prefs', [4]);

    const db = await openUpgraded('migrate-prefs');

    expect(await db.preferences.count()).toBe(0);
  });

  it('leaves a fresh database empty rather than failing to upgrade', async () => {
    const db = await openUpgraded('migrate-fresh');

    expect(await db.ratings.count()).toBe(0);
    expect(db.verno).toBe(6);
  });
});

describe('v4 pendingAiTasks.beanId index', () => {
  it('can query tasks by bean on a database upgraded from v1', async () => {
    // Dexie throws SchemaError on `where()` against an unindexed keypath, so
    // this is the difference between discarding a draft working and it failing
    // after the coffee has already been deleted.
    await seedV1('migrate-tasks', [3]);

    const db = await openUpgraded('migrate-tasks');
    await db.pendingAiTasks.add({
      id: 't1',
      schemaVersion: 1,
      type: 'web-enrich',
      payload: {},
      beanId: 'b1',
      attempts: 0,
      createdAt: '2026-01-02T00:00:00.000Z',
    });

    expect(await db.pendingAiTasks.where('beanId').equals('b1').count()).toBe(1);
    expect(await db.pendingAiTasks.where('beanId').equals('b2').count()).toBe(0);
  });
});

/**
 * Seeds beans carrying the retired `vendor` field, which shipped briefly on the
 * wrong idea that a Cometeer box is coffee *sold by* Cometeer.
 */
async function seedWithVendors(name: string, vendors: (string | undefined)[]): Promise<void> {
  const legacy = new Dexie(name);
  legacy.version(1).stores({
    beans: 'id, roaster, createdAt, isArchived, needsReview, *tastingNotes',
    ratings: 'id, beanId, ratedAt, brewType',
    photos: 'id, kind',
    ocrResults: 'id, photoId',
    preferences: 'id',
    pendingAiTasks: 'id, type, nextAttemptAt',
    meta: 'key',
  });
  await legacy.open();
  await legacy.table('beans').bulkAdd(
    vendors.map((vendor, i) => ({
      id: `b${i}`,
      schemaVersion: 1,
      name: `Coffee ${i}`,
      roaster: 'Counter Culture Coffee',
      source: 'photo',
      isArchived: false,
      needsReview: false,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      ...(vendor === undefined ? {} : { vendor }),
    })),
  );
  legacy.close();
}

describe('v6 vendor-to-format migration', () => {
  it('moves a vendor that named a delivery system onto format', async () => {
    await seedWithVendors('migrate-fmt-known', ['Cometeer', 'nespresso', 'Keurig']);

    const db = await openUpgraded('migrate-fmt-known');
    const beans = await db.beans.orderBy('id').toArray();

    expect(beans.map((b) => b.format)).toEqual(['cometeer', 'nespresso', 'k-cup']);
  });

  it('discards a vendor that was only ever a shop', async () => {
    // The whole point of the correction: where a coffee was bought says nothing
    // about the coffee, so "Sprouts" is dropped rather than relabelled.
    await seedWithVendors('migrate-fmt-shop', ['Sprouts']);

    const db = await openUpgraded('migrate-fmt-shop');
    const bean = await db.beans.get('b0');

    expect(bean?.format).toBeUndefined();
  });

  it('removes the field itself so it stops syncing between devices', async () => {
    await seedWithVendors('migrate-fmt-drop', ['Cometeer', 'Sprouts']);

    const db = await openUpgraded('migrate-fmt-drop');
    const beans = await db.beans.toArray();

    expect(beans.every((b) => !('vendor' in b))).toBe(true);
  });

  it('leaves a coffee that never had a vendor untouched', async () => {
    await seedWithVendors('migrate-fmt-none', [undefined]);

    const db = await openUpgraded('migrate-fmt-none');
    const bean = await db.beans.get('b0');

    expect(bean?.format).toBeUndefined();
    expect(bean?.roaster).toBe('Counter Culture Coffee');
  });
});
