import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean, PendingAiTask, PhotoBlob, Rating } from '@/types';

import { deleteBeans, summariseDeletion } from './delete';

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

function rating(id: string, beanId: string): Rating {
  return {
    id,
    schemaVersion: 1,
    beanId,
    score: 4,
    ratedAt: '2026-01-02T00:00:00.000Z',
  } as Rating;
}

function photo(id: string): PhotoBlob {
  return { id, kind: 'bag', blob: new Blob(['x']) } as unknown as PhotoBlob;
}

function task(id: string, beanId?: string): PendingAiTask {
  return {
    id,
    schemaVersion: 1,
    type: 'ocr',
    payload: {},
    attempts: 0,
    ...(beanId ? { beanId } : {}),
  } as unknown as PendingAiTask;
}

beforeEach(async () => {
  await Promise.all([
    db.beans.clear(),
    db.ratings.clear(),
    db.photos.clear(),
    db.ocrResults.clear(),
    db.pendingAiTasks.clear(),
  ]);
});

describe('deleteBeans', () => {
  it('removes the bean along with its ratings, photo, OCR result and queued tasks', async () => {
    await db.beans.add(bean('b1', { photoId: 'p1' }));
    await db.ratings.bulkAdd([rating('r1', 'b1'), rating('r2', 'b1')]);
    await db.photos.add(photo('p1'));
    await db.ocrResults.add({
      id: 'o1',
      schemaVersion: 1,
      photoId: 'p1',
      rawText: 'x',
      provider: 'azure-vision',
    } as never);
    await db.pendingAiTasks.add(task('t1', 'b1'));

    const summary = await deleteBeans(['b1']);

    expect(summary).toEqual({ beans: 1, ratings: 2, photos: 1 });
    expect(await db.beans.count()).toBe(0);
    expect(await db.ratings.count()).toBe(0);
    expect(await db.photos.count()).toBe(0);
    expect(await db.ocrResults.count()).toBe(0);
    expect(await db.pendingAiTasks.count()).toBe(0);
  });

  it('leaves other beans and their data untouched', async () => {
    await db.beans.bulkAdd([bean('b1', { photoId: 'p1' }), bean('b2', { photoId: 'p2' })]);
    await db.ratings.bulkAdd([rating('r1', 'b1'), rating('r2', 'b2')]);
    await db.photos.bulkAdd([photo('p1'), photo('p2')]);
    await db.pendingAiTasks.bulkAdd([task('t1', 'b1'), task('t2', 'b2')]);

    await deleteBeans(['b1']);

    expect(await db.beans.toCollection().primaryKeys()).toEqual(['b2']);
    expect(await db.ratings.toCollection().primaryKeys()).toEqual(['r2']);
    expect(await db.photos.toCollection().primaryKeys()).toEqual(['p2']);
    expect(await db.pendingAiTasks.toCollection().primaryKeys()).toEqual(['t2']);
  });

  it('keeps a shared photo that a surviving bean still points at', async () => {
    await db.beans.bulkAdd([bean('b1', { photoId: 'shared' }), bean('b2', { photoId: 'shared' })]);
    await db.photos.add(photo('shared'));

    const summary = await deleteBeans(['b1']);

    expect(summary.photos).toBe(0);
    expect(await db.photos.get('shared')).toBeDefined();
  });

  it('removes a shared photo once every bean holding it is gone', async () => {
    await db.beans.bulkAdd([bean('b1', { photoId: 'shared' }), bean('b2', { photoId: 'shared' })]);
    await db.photos.add(photo('shared'));

    const summary = await deleteBeans(['b1', 'b2']);

    expect(summary.photos).toBe(1);
    expect(await db.photos.get('shared')).toBeUndefined();
  });

  it('deletes several beans at once', async () => {
    await db.beans.bulkAdd([bean('b1'), bean('b2'), bean('b3')]);
    await db.ratings.bulkAdd([rating('r1', 'b1'), rating('r3', 'b3')]);

    const summary = await deleteBeans(['b1', 'b3']);

    expect(summary).toEqual({ beans: 2, ratings: 2, photos: 0 });
    expect(await db.beans.toCollection().primaryKeys()).toEqual(['b2']);
  });

  it('ignores ids that are not in the database', async () => {
    await db.beans.add(bean('b1'));

    const summary = await deleteBeans(['b1', 'does-not-exist']);

    expect(summary.beans).toBe(1);
    expect(await db.beans.count()).toBe(0);
  });

  it('is a no-op for an empty selection', async () => {
    await db.beans.add(bean('b1'));

    expect(await deleteBeans([])).toEqual({ beans: 0, ratings: 0, photos: 0 });
    expect(await db.beans.count()).toBe(1);
  });

  it('leaves queue tasks that belong to no bean alone', async () => {
    await db.beans.add(bean('b1'));
    await db.pendingAiTasks.bulkAdd([task('t1', 'b1'), task('t2')]);

    await deleteBeans(['b1']);

    expect(await db.pendingAiTasks.toCollection().primaryKeys()).toEqual(['t2']);
  });
});

describe('summariseDeletion', () => {
  it('counts what would be removed without removing it', async () => {
    await db.beans.bulkAdd([bean('b1', { photoId: 'p1' }), bean('b2')]);
    await db.ratings.bulkAdd([rating('r1', 'b1'), rating('r2', 'b1'), rating('r3', 'b2')]);

    const summary = await summariseDeletion(['b1', 'b2']);

    expect(summary).toEqual({ beans: 2, ratings: 3, photos: 1 });
    expect(await db.beans.count()).toBe(2);
  });

  it('reports nothing for an empty selection', async () => {
    expect(await summariseDeletion([])).toEqual({ beans: 0, ratings: 0, photos: 0 });
  });
});
