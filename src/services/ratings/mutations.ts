import { db } from '@/services/db';
import type { BrewType, Rating } from '@/types';

/**
 * Ratings are the only record of what a coffee actually tasted like, and they
 * feed the preference profile behind recommendations. A mistyped score skews
 * that profile until it is corrected, so editing and removing a rating has to
 * be as available as adding one.
 */

/** The fields a user can change after the fact. Everything else is bookkeeping. */
export interface RatingEdit {
  score: number;
  brewType: BrewType;
  notes?: string;
}

export class RatingNotFoundError extends Error {
  constructor(id: string) {
    super(`Rating ${id} no longer exists`);
    this.name = 'RatingNotFoundError';
  }
}

function assertValidScore(score: number): void {
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new RangeError(`Score must be a whole number from 1 to 5, got ${score}`);
  }
}

export async function updateRating(id: string, edit: RatingEdit): Promise<Rating> {
  assertValidScore(edit.score);

  return db.transaction('rw', db.ratings, async () => {
    const existing = await db.ratings.get(id);
    if (!existing) throw new RatingNotFoundError(id);

    const notes = edit.notes?.trim();
    const updated: Rating = {
      ...existing,
      score: edit.score,
      brewType: edit.brewType,
      updatedAt: new Date().toISOString(),
      ...(notes ? { notes } : {}),
    };
    // An emptied note means "remove it", not "store an empty string".
    if (!notes) delete updated.notes;

    await db.ratings.put(updated);
    return updated;
  });
}

/**
 * Removes a rating and any cup photo it alone owned. A photo is only dropped
 * once no surviving rating points at it, so a shared one is left intact.
 */
export async function deleteRating(id: string): Promise<void> {
  await db.transaction('rw', [db.ratings, db.photos], async () => {
    const existing = await db.ratings.get(id);
    if (!existing) return;

    await db.ratings.delete(id);

    const cupPhotoId = existing.cupPhotoId;
    if (cupPhotoId) {
      const stillReferenced = await db.ratings.filter((r) => r.cupPhotoId === cupPhotoId).count();
      if (stillReferenced === 0) await db.photos.delete(cupPhotoId);
    }
  });
}
