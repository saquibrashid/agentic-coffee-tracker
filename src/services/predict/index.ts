/** Wires the pure predictor to the local library. */
import { db } from '@/services/db';
import {
  buildIndex,
  predict,
  type Candidate,
  type Prediction,
  type PredictionIndex,
} from './predict';

/**
 * Fewer ratings than this and the answer is arithmetic on noise. The UI should
 * ask for more history rather than present a confident-looking number.
 */
export const MIN_RATINGS_FOR_PREDICTION = 3;

export async function loadPredictionIndex(): Promise<PredictionIndex> {
  const [beans, ratings] = await Promise.all([db.beans.toArray(), db.ratings.toArray()]);
  return buildIndex(beans, ratings);
}

export function canPredict(index: PredictionIndex): boolean {
  return index.totalRatings >= MIN_RATINGS_FOR_PREDICTION;
}

export async function predictFromLibrary(candidate: Candidate): Promise<Prediction> {
  return predict(candidate, await loadPredictionIndex());
}
