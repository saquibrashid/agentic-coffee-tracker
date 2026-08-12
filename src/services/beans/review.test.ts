import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import { markBeanReviewed } from './review';
import type { CoffeeBean } from '@/types';

function bean(overrides: Partial<CoffeeBean> = {}): CoffeeBean {
  return {
    id: 'b1',
    schemaVersion: 1,
    roaster: 'Blue Bottle Coffee',
    name: 'Night Light Decaf',
    source: 'manual',
    isArchived: false,
    needsReview: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  await db.beans.clear();
  await db.outbox.clear();
});

describe('markBeanReviewed', () => {
  it('clears the flag the library badges', async () => {
    await db.beans.add(bean());

    await markBeanReviewed('b1');

    expect((await db.beans.get('b1'))?.needsReview).toBe(false);
  });

  it("sends the change to the user's other devices", async () => {
    await db.beans.add(bean());

    await markBeanReviewed('b1');

    const queued = await db.outbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ type: 'bean', recordId: 'b1', op: 'upsert' });
  });

  it('moves updatedAt on, so the confirmation survives a sync', async () => {
    await db.beans.add(bean());

    await markBeanReviewed('b1');

    expect((await db.beans.get('b1'))?.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  /*
   * Reviewing an already-reviewed coffee must not write. A pointless revision
   * would be pushed to every other device and could lose a real edit made
   * elsewhere to a last-writer-wins merge.
   */
  it('does not write when there is nothing to settle', async () => {
    await db.beans.add(bean({ needsReview: false }));

    await markBeanReviewed('b1');

    expect((await db.beans.get('b1'))?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(await db.outbox.count()).toBe(0);
  });

  it('shrugs at a coffee that is gone', async () => {
    await expect(markBeanReviewed('missing')).resolves.toBeUndefined();
  });
});
