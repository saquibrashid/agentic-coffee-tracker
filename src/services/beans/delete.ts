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

  const doomedRatings = await db.ratings.where('beanId').anyOf(beanIds).toArray();
  const beans = await db.beans.bulkGet(beanIds);
  const photos = new Set([
    ...beans.flatMap((b) => (b?.photoId ? [b.photoId] : [])),
    ...doomedRatings.flatMap((r) => (r.cupPhotoId ? [r.cupPhotoId] : [])),
  ]);

  return {
    beans: beans.filter(Boolean).length,
    ratings: doomedRatings.length,
    photos: photos.size,
  };
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

      const doomedRatings = await db.ratings.where('beanId').anyOf(foundIds).toArray();
      const ratingIds = doomedRatings.map((r) => r.id);
      await db.ratings.bulkDelete(ratingIds);

      const taskIds = await db.pendingAiTasks
        .filter((task) => task.beanId !== undefined && foundIds.includes(task.beanId))
        .primaryKeys();
      await db.pendingAiTasks.bulkDelete(taskIds);

      // A photo is only removed once nothing else points at it. Beans are
      // normally one-to-one with their photo, but an import or a duplicate can
      // share one, and deleting it out from under a surviving bean would leave
      // that bean with a broken image. Cup photos hang off the ratings that are
      // going with the bean, so they are checked the same way.
      const bagPhotoIds = targets.flatMap((b) => (b.photoId ? [b.photoId] : []));
      const cupPhotoIds = doomedRatings.flatMap((r) => (r.cupPhotoId ? [r.cupPhotoId] : []));
      const photoIds = [...new Set([...bagPhotoIds, ...cupPhotoIds])];
      const orphaned: string[] = [];
      for (const photoId of photoIds) {
        const otherBeans = await db.beans
          .filter((b) => b.photoId === photoId && !foundIds.includes(b.id))
          .count();
        if (otherBeans > 0) continue;
        // The doomed ratings are already gone, so anything left here is a
        // survivor that still needs the photo.
        const otherRatings = await db.ratings.filter((r) => r.cupPhotoId === photoId).count();
        if (otherRatings === 0) orphaned.push(photoId);
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
