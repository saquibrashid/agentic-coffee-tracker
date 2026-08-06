import { db } from '@/services/db';

/**
 * Removing a bean has to remove everything hanging off it. A bean owns ratings,
 * a photo, the OCR result for that photo, and any queued AI work — leaving any
 * of those behind means storage that the user believes they freed stays
 * occupied, and orphaned queue tasks that retry against a bean that is gone.
 *
 * The whole cascade runs in one Dexie transaction so a failure part-way cannot
 * leave a half-deleted bean.
 */

export interface DeletionSummary {
  beans: number;
  ratings: number;
  photos: number;
}

/** What a delete would remove, so the confirmation can name real numbers. */
export async function summariseDeletion(beanIds: string[]): Promise<DeletionSummary> {
  if (beanIds.length === 0) return { beans: 0, ratings: 0, photos: 0 };

  const ratings = await db.ratings.where('beanId').anyOf(beanIds).count();
  const beans = await db.beans.bulkGet(beanIds);
  const photos = beans.filter((b) => b?.photoId).length;

  return { beans: beans.filter(Boolean).length, ratings, photos };
}

export async function deleteBeans(beanIds: string[]): Promise<DeletionSummary> {
  if (beanIds.length === 0) return { beans: 0, ratings: 0, photos: 0 };

  return db.transaction(
    'rw',
    [db.beans, db.ratings, db.photos, db.ocrResults, db.pendingAiTasks],
    async () => {
      const targets = (await db.beans.bulkGet(beanIds)).filter((b) => b !== undefined);
      const foundIds = targets.map((b) => b.id);
      if (foundIds.length === 0) return { beans: 0, ratings: 0, photos: 0 };

      const ratingIds = await db.ratings.where('beanId').anyOf(foundIds).primaryKeys();
      await db.ratings.bulkDelete(ratingIds);

      const taskIds = await db.pendingAiTasks
        .filter((task) => task.beanId !== undefined && foundIds.includes(task.beanId))
        .primaryKeys();
      await db.pendingAiTasks.bulkDelete(taskIds);

      // A photo is only removed once nothing else points at it. Beans are
      // normally one-to-one with their photo, but an import or a duplicate can
      // share one, and deleting it out from under a surviving bean would leave
      // that bean with a broken image.
      const photoIds = [...new Set(targets.flatMap((b) => (b.photoId ? [b.photoId] : [])))];
      const orphaned: string[] = [];
      for (const photoId of photoIds) {
        const otherHolders = await db.beans
          .filter((b) => b.photoId === photoId && !foundIds.includes(b.id))
          .count();
        if (otherHolders === 0) orphaned.push(photoId);
      }

      if (orphaned.length > 0) {
        const ocrIds = await db.ocrResults.where('photoId').anyOf(orphaned).primaryKeys();
        await db.ocrResults.bulkDelete(ocrIds);
        await db.photos.bulkDelete(orphaned);
      }

      await db.beans.bulkDelete(foundIds);

      return { beans: foundIds.length, ratings: ratingIds.length, photos: orphaned.length };
    },
  );
}
