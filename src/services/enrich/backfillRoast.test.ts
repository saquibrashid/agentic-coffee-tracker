import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean } from '@/types';

import { backfillRoastLevels } from './backfillRoast';

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

describe('backfillRoastLevels', () => {
  it('fills a roast level that the name already names', async () => {
    await db.beans.add(bean('a', { name: 'French Roast', roastLevel: 'unknown' }));

    const result = await backfillRoastLevels();

    expect(result).toEqual({ considered: 1, filled: 1 });
    expect((await db.beans.get('a'))?.roastLevel).toBe('dark');
  });

  it('treats a missing roast level the same as "unknown"', async () => {
    await db.beans.add(bean('a', { name: 'Blonde Roast' }));

    await backfillRoastLevels();

    expect((await db.beans.get('a'))?.roastLevel).toBe('light');
  });

  it('reads the roaster description when the name says nothing', async () => {
    await db.beans.add(
      bean('a', {
        name: 'Southpaw',
        roastLevel: 'unknown',
        roasterDescription: 'Taken to a full city, just shy of second crack.',
      }),
    );

    await backfillRoastLevels();

    expect((await db.beans.get('a'))?.roastLevel).toBe('medium-dark');
  });

  it('never overwrites a roast level the user already set', async () => {
    // "French Roast" would infer to dark, so this only passes if the pass
    // refuses to consider a bean that already has an answer.
    await db.beans.add(bean('a', { name: 'French Roast', roastLevel: 'light' }));

    const result = await backfillRoastLevels();

    expect(result).toEqual({ considered: 0, filled: 0 });
    expect((await db.beans.get('a'))?.roastLevel).toBe('light');
  });

  it('leaves a bean alone when nothing in its text names a roast', async () => {
    await db.beans.add(
      bean('a', {
        name: 'Southpaw',
        roastLevel: 'unknown',
        tastingNotes: ['dark chocolate', 'light caramel'],
      }),
    );

    const result = await backfillRoastLevels();

    expect(result).toEqual({ considered: 1, filled: 0 });
    expect((await db.beans.get('a'))?.roastLevel).toBe('unknown');
    expect(await db.outbox.count()).toBe(0);
  });

  it('queues each filled bean for sync', async () => {
    await db.beans.add(bean('a', { name: 'French Roast', roastLevel: 'unknown' }));
    await db.beans.add(bean('b', { name: 'Southpaw', roastLevel: 'unknown' }));

    await backfillRoastLevels();

    const queued = await db.outbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.recordId).toBe('a');
  });

  it('bumps updatedAt so the write survives a sync merge', async () => {
    // Last-write-wins means a fill carrying its original timestamp would lose
    // to the stale copy still sitting in the cloud.
    await db.beans.add(bean('a', { name: 'French Roast', roastLevel: 'unknown' }));

    await backfillRoastLevels();

    expect((await db.beans.get('a'))?.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('is a no-op on a second pass', async () => {
    await db.beans.add(bean('a', { name: 'French Roast', roastLevel: 'unknown' }));

    await backfillRoastLevels();
    const second = await backfillRoastLevels();

    expect(second).toEqual({ considered: 0, filled: 0 });
  });
});
