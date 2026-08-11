import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean } from '@/types';

import { relookupIncompleteBeans } from './relookup';

/**
 * A failed lookup is dropped rather than retried forever, which strands every
 * coffee that failed under an older, worse search. This is the way back.
 */

function bean(overrides: Partial<CoffeeBean> = {}): CoffeeBean {
  return {
    id: 'b1',
    schemaVersion: 1,
    roaster: 'Stumptown Coffee Roasters',
    name: 'Holler Mtn.',
    roastLevel: 'unknown',
    process: 'unknown',
    origins: [],
    tastingNotes: [],
    needsReview: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as CoffeeBean;
}

const complete = bean({
  id: 'done',
  name: 'Hair Bender',
  roastLevel: 'medium',
  process: 'washed',
  origins: [{ country: 'Ethiopia' }],
  tastingNotes: ['Citrus'],
  photoId: 'photo-1',
});

beforeEach(async () => {
  await db.beans.clear();
  await db.pendingAiTasks.clear();
});

describe('relookupIncompleteBeans', () => {
  it('queues a lookup for every coffee still missing details', async () => {
    await db.beans.bulkAdd([bean({ id: 'a' }), bean({ id: 'b' }), complete]);

    const result = await relookupIncompleteBeans();

    expect(result).toEqual({ incomplete: 2, queued: 2 });
    const tasks = await db.pendingAiTasks.toArray();
    expect(tasks.map((t) => t.beanId).sort()).toEqual(['a', 'b']);
    expect(tasks.every((t) => t.type === 'web-enrich')).toBe(true);
  });

  it('leaves complete coffees alone', async () => {
    await db.beans.add(complete);

    expect(await relookupIncompleteBeans()).toEqual({ incomplete: 0, queued: 0 });
    expect(await db.pendingAiTasks.count()).toBe(0);
  });

  it('does not queue a second lookup for a coffee already waiting on one', async () => {
    await db.beans.add(bean({ id: 'a' }));
    await db.pendingAiTasks.add({
      id: 't1',
      schemaVersion: 1,
      type: 'web-enrich',
      payload: {},
      beanId: 'a',
      attempts: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    // Still reported as incomplete, so the count the user sees stays honest.
    expect(await relookupIncompleteBeans()).toEqual({ incomplete: 1, queued: 0 });
    expect(await db.pendingAiTasks.count()).toBe(1);
  });

  it('skips archived coffees', async () => {
    await db.beans.add(bean({ id: 'a', isArchived: true }));

    expect(await relookupIncompleteBeans()).toEqual({ incomplete: 0, queued: 0 });
  });

  it('is safe to run twice in a row', async () => {
    await db.beans.add(bean({ id: 'a' }));

    await relookupIncompleteBeans();
    expect(await relookupIncompleteBeans()).toEqual({ incomplete: 1, queued: 0 });
    expect(await db.pendingAiTasks.count()).toBe(1);
  });
});
