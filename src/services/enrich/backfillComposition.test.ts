import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean } from '@/types';

import { backfillComposition } from './backfillComposition';

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

describe('backfillComposition', () => {
  it('reads a blend out of the name', async () => {
    await db.beans.add(bean('a', { name: 'Hair Bender Coffee Blend' }));

    const result = await backfillComposition();

    expect(result).toEqual({ considered: 1, inferred: 1 });
    expect((await db.beans.get('a'))?.composition).toBe('blend');
  });

  it('reads a single origin out of the roaster description', async () => {
    await db.beans.add(
      bean('a', {
        name: 'Sunrider',
        roasterDescription: 'An exclusive single origin, grown high in Antioquia.',
      }),
    );

    await backfillComposition();

    expect((await db.beans.get('a'))?.composition).toBe('single-origin');
  });

  it('leaves a coffee whose text says neither word alone', async () => {
    // The difference from the caffeine backfill, which assumes. Blends and
    // single origins are both ordinary, so there is no prior to fall back on
    // and a guess would be wrong for about half a library.
    await db.beans.add(
      bean('a', { name: 'Night Light Decaf', roasterDescription: 'Chocolate and marshmallow.' }),
    );

    const result = await backfillComposition();

    expect(result).toEqual({ considered: 1, inferred: 0 });
    expect((await db.beans.get('a'))?.composition).toBeUndefined();
  });

  it('respects an explicit "not known" as an answer, not a gap', async () => {
    // "Not known" is a real choice in the bean page's control: the user looked
    // and the roaster does not say. Re-deriving over it would overrule that on
    // every app start, forever.
    await db.beans.add(bean('a', { name: 'House Blend', composition: 'unknown' }));

    const result = await backfillComposition();

    expect(result).toEqual({ considered: 0, inferred: 0 });
    expect((await db.beans.get('a'))?.composition).toBe('unknown');
  });

  it('never revisits a composition the user already set', async () => {
    // A hand-set value is a fact no inference can beat -- including one that
    // contradicts the name, which is exactly the case worth protecting.
    await db.beans.add(bean('a', { name: 'House Blend', composition: 'single-origin' }));

    const result = await backfillComposition();

    expect(result).toEqual({ considered: 0, inferred: 0 });
    expect((await db.beans.get('a'))?.composition).toBe('single-origin');
  });

  it('reaches a coffee that enrichment has given up on', async () => {
    // The case this pass exists for, with the real product's real name and the
    // opening of its real description. #309 marks Holler Mountain's missing
    // process as unpublished so it stops being re-queued, which means no future
    // lookup will ever visit it -- and note the name alone says nothing, so the
    // description is what has to carry this.
    await db.beans.add(
      bean('a', {
        roaster: 'Stumptown',
        name: 'Holler Mountain',
        roasterDescription:
          'Our Holler Mountain organic coffee blend has been a hometown favorite since day one.',
        origins: [{ country: 'Ethiopia' }],
        process: 'washed',
        roastLevel: 'medium',
        tastingNotes: ['citrus'],
        photoId: 'p1',
        unpublishedFields: ['process'],
      }),
    );

    await backfillComposition();

    expect((await db.beans.get('a'))?.composition).toBe('blend');
  });

  it('does not bump updatedAt or enqueue a sync', async () => {
    // Both would let a locally derived value outrank a real change made on
    // another device. The caffeine backfill learned this the hard way: it
    // resurrected a deleted bean, which an e2e two-device test caught.
    await db.beans.add(bean('a', { name: 'House Blend' }));

    await backfillComposition();

    expect((await db.beans.get('a'))?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    await expect(db.outbox.count()).resolves.toBe(0);
  });

  it('converges, so running on every start is safe', async () => {
    await db.beans.add(bean('a', { name: 'House Blend' }));
    await db.beans.add(bean('b', { name: 'Something Quiet' }));

    const first = await backfillComposition();
    const second = await backfillComposition();

    expect(first).toEqual({ considered: 2, inferred: 1 });
    // The resolved bean drops out; the unresolvable one is reconsidered, which
    // is wanted -- its name may be corrected or a lookup may add prose later.
    expect(second).toEqual({ considered: 1, inferred: 0 });
  });
});
