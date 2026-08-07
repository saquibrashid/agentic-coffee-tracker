import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import type { PhotoBlob, Rating } from '@/types';

import { RatingNotFoundError, deleteRating, updateRating } from './mutations';

function rating(id: string, overrides: Partial<Rating> = {}): Rating {
  return {
    id,
    schemaVersion: 2,
    beanId: 'b1',
    score: 8,
    brewType: 'drip',
    ratedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function photo(id: string): PhotoBlob {
  return { id, kind: 'cup', blob: new Blob(['x']) } as unknown as PhotoBlob;
}

beforeEach(async () => {
  await Promise.all([db.ratings.clear(), db.photos.clear()]);
});

describe('updateRating', () => {
  it('saves the edited score, brew type and notes', async () => {
    await db.ratings.add(rating('r1', { notes: 'thin' }));

    const updated = await updateRating('r1', {
      score: 5,
      brewType: 'espresso',
      notes: '  syrupy  ',
    });

    expect(updated.score).toBe(5);
    expect(updated.brewType).toBe('espresso');
    // Trimmed: leading/trailing whitespace is not part of the note.
    expect(updated.notes).toBe('syrupy');

    const stored = await db.ratings.get('r1');
    expect(stored?.score).toBe(5);
    expect(stored?.notes).toBe('syrupy');
  });

  it('drops the note entirely when it is cleared, rather than storing an empty string', async () => {
    await db.ratings.add(rating('r1', { notes: 'thin' }));

    await updateRating('r1', { score: 4, brewType: 'drip', notes: '   ' });

    const stored = await db.ratings.get('r1');
    expect(stored).toBeDefined();
    expect('notes' in stored!).toBe(false);
  });

  it('bumps updatedAt but preserves identity and when it was rated', async () => {
    await db.ratings.add(rating('r1'));

    const updated = await updateRating('r1', { score: 2, brewType: 'latte' });

    expect(updated.id).toBe('r1');
    expect(updated.beanId).toBe('b1');
    expect(updated.ratedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(updated.createdAt).toBe('2026-01-02T00:00:00.000Z');
    expect(updated.updatedAt).not.toBe('2026-01-02T00:00:00.000Z');
  });

  it('rejects a score off the 1..10 half-step scale without touching the stored record', async () => {
    await db.ratings.add(rating('r1'));

    await expect(updateRating('r1', { score: 11, brewType: 'drip' })).rejects.toThrow(RangeError);
    await expect(updateRating('r1', { score: 0, brewType: 'drip' })).rejects.toThrow(RangeError);
    await expect(updateRating('r1', { score: 3.7, brewType: 'drip' })).rejects.toThrow(RangeError);

    expect((await db.ratings.get('r1'))?.score).toBe(8);
  });

  it('reports a rating that no longer exists rather than silently creating one', async () => {
    await expect(updateRating('gone', { score: 4, brewType: 'drip' })).rejects.toThrow(
      RatingNotFoundError,
    );
    expect(await db.ratings.count()).toBe(0);
  });
});

describe('deleteRating', () => {
  it('removes the rating', async () => {
    await db.ratings.bulkAdd([rating('r1'), rating('r2')]);

    await deleteRating('r1');

    expect(await db.ratings.get('r1')).toBeUndefined();
    expect(await db.ratings.get('r2')).toBeDefined();
  });

  it('removes a cup photo that nothing else points at', async () => {
    await db.photos.add(photo('cup1'));
    await db.ratings.add(rating('r1', { cupPhotoId: 'cup1' }));

    await deleteRating('r1');

    expect(await db.photos.get('cup1')).toBeUndefined();
  });

  it('keeps a cup photo that a surviving rating still uses', async () => {
    await db.photos.add(photo('cup1'));
    await db.ratings.bulkAdd([
      rating('r1', { cupPhotoId: 'cup1' }),
      rating('r2', { cupPhotoId: 'cup1' }),
    ]);

    await deleteRating('r1');

    expect(await db.photos.get('cup1')).toBeDefined();
  });

  it('is a no-op for a rating that is already gone', async () => {
    await expect(deleteRating('missing')).resolves.toBeUndefined();
  });
});
