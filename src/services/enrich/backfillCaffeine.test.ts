import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean } from '@/types';

import { backfillCaffeine } from './backfillCaffeine';

function bean(id: string, overrides: Partial<CoffeeBean> = {}): CoffeeBean {
  return {
    id,
    schemaVersion: 1,
    roaster: 'Anchorhead',
    name: `Bean ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isArchived: false,
    needsReview: false,
    ...overrides,
  } as CoffeeBean;
}

beforeEach(async () => {
  await db.beans.clear();
  await db.outbox.clear();
});

describe('backfillCaffeine', () => {
  it('assumes caffeinated when nothing says otherwise', async () => {
    await db.beans.add(bean('a', { name: 'Hair Bender' }));

    const result = await backfillCaffeine();

    expect(result).toEqual({ considered: 1, inferred: 0, assumed: 1 });
    expect((await db.beans.get('a'))?.caffeine).toBe('caffeinated');
  });

  it('reads decaf out of the name rather than assuming', async () => {
    await db.beans.add(bean('a', { name: 'Night Light Decaf' }));

    const result = await backfillCaffeine();

    expect(result).toEqual({ considered: 1, inferred: 1, assumed: 0 });
    expect((await db.beans.get('a'))?.caffeine).toBe('decaf');
  });

  it('reads a decaffeination method out of the roaster description', async () => {
    await db.beans.add(
      bean('a', {
        name: 'Storyville Reserve',
        roasterDescription: 'Swiss Water processed, so you can drink it at night.',
      }),
    );

    await backfillCaffeine();

    expect((await db.beans.get('a'))?.caffeine).toBe('decaf');
  });

  it('treats an explicit "unknown" the same as a missing value', async () => {
    await db.beans.add(bean('a', { name: 'Hair Bender', caffeine: 'unknown' }));

    const result = await backfillCaffeine();

    expect(result.considered).toBe(1);
    expect((await db.beans.get('a'))?.caffeine).toBe('caffeinated');
  });

  it('never overwrites a value the user set by hand', async () => {
    // The whole point of the correction on the bean page: a decaf the app
    // guessed wrong about, then the user fixed, must survive the next app start.
    await db.beans.add(bean('a', { name: 'Hair Bender', caffeine: 'decaf' }));

    const result = await backfillCaffeine();

    expect(result).toEqual({ considered: 0, inferred: 0, assumed: 0 });
    expect((await db.beans.get('a'))?.caffeine).toBe('decaf');
  });

  it('queues every written bean for sync', async () => {
    await db.beans.add(bean('a', { name: 'Hair Bender' }));
    await db.beans.add(bean('b', { name: 'Night Light Decaf' }));

    await backfillCaffeine();

    const queued = await db.outbox.toArray();
    expect(queued.map((row) => row.recordId).sort()).toEqual(['a', 'b']);
  });

  it('bumps updatedAt so the write survives a sync merge', async () => {
    // Last-write-wins: a write carrying its original timestamp would lose to
    // the stale copy still sitting in the cloud.
    await db.beans.add(bean('a', { name: 'Hair Bender' }));

    await backfillCaffeine();

    expect((await db.beans.get('a'))?.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('is a no-op on a second pass', async () => {
    await db.beans.add(bean('a', { name: 'Hair Bender' }));

    await backfillCaffeine();
    const second = await backfillCaffeine();

    expect(second).toEqual({ considered: 0, inferred: 0, assumed: 0 });
  });
});
