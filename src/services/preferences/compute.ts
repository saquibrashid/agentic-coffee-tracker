/**
 * Derives `UserPreferences` from the local ratings history (specs/data-model.md).
 *
 * Ranking uses `averageScore * log2(1 + count)` rather than a raw average, so a
 * single 5-star cup cannot outrank an origin the user has enjoyed a dozen times.
 * Everything is computed locally — preferences never leave the device except as
 * the small, anonymous summary sent to `/api/recommend`.
 */
import { db } from '@/services/db';
import type {
  BrewType,
  CoffeeBean,
  Process,
  RankedItem,
  Rating,
  RoastLevel,
  UserPreferences,
} from '@/types';

/** A value must have at least this many rated cups before it can be ranked. */
const MIN_OBSERVATIONS = 1;
const TOP_N = 5;

interface Accumulator {
  count: number;
  total: number;
}

function add(map: Map<string, Accumulator>, key: string, score: number): void {
  const current = map.get(key) ?? { count: 0, total: 0 };
  current.count += 1;
  current.total += score;
  map.set(key, current);
}

function rank<T extends string>(map: Map<string, Accumulator>): RankedItem<T>[] {
  return Array.from(map.entries())
    .filter(([, acc]) => acc.count >= MIN_OBSERVATIONS)
    .map(([value, acc]) => {
      const averageScore = acc.total / acc.count;
      return {
        value: value as T,
        count: acc.count,
        averageScore,
        weightedScore: averageScore * Math.log2(1 + acc.count),
      };
    })
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, TOP_N);
}

export function computePreferencesFrom(
  beans: CoffeeBean[],
  ratings: Rating[],
): UserPreferences {
  const beanById = new Map(beans.map((bean) => [bean.id, bean]));

  const origins = new Map<string, Accumulator>();
  const roasters = new Map<string, Accumulator>();
  const processes = new Map<string, Accumulator>();
  const roastLevels = new Map<string, Accumulator>();
  const flavors = new Map<string, Accumulator>();
  const brewTypes = new Map<string, Accumulator>();

  let scoreTotal = 0;

  for (const rating of ratings) {
    const score = rating.score || 0;
    scoreTotal += score;

    if (rating.brewType) add(brewTypes, rating.brewType, score);

    const bean = beanById.get(rating.beanId);
    if (!bean) continue;

    if (bean.roaster) add(roasters, bean.roaster, score);
    if (bean.process && bean.process !== 'unknown') add(processes, bean.process, score);
    if (bean.roastLevel && bean.roastLevel !== 'unknown') add(roastLevels, bean.roastLevel, score);
    for (const origin of bean.origins ?? []) {
      if (origin.country) add(origins, origin.country, score);
    }
    for (const note of bean.tastingNotes ?? []) {
      add(flavors, note.toLowerCase(), score);
    }
  }

  return {
    id: 'singleton',
    schemaVersion: 1,
    computedAt: new Date().toISOString(),
    favoriteOrigins: rank<string>(origins),
    favoriteRoasters: rank<string>(roasters),
    favoriteProcesses: rank<Process>(processes),
    favoriteRoastLevels: rank<RoastLevel>(roastLevels),
    favoriteFlavors: rank<string>(flavors),
    favoriteBrewTypes: rank<BrewType>(brewTypes),
    averageScore: ratings.length === 0 ? 0 : scoreTotal / ratings.length,
    totalRatings: ratings.length,
    totalBeans: beans.length,
  };
}

/** Recomputes preferences from IndexedDB and persists the singleton record. */
export async function refreshPreferences(): Promise<UserPreferences> {
  const [beans, ratings] = await Promise.all([db.beans.toArray(), db.ratings.toArray()]);
  const preferences = computePreferencesFrom(beans, ratings);
  await db.preferences.put(preferences);
  return preferences;
}

export async function getPreferences(): Promise<UserPreferences | undefined> {
  return db.preferences.get('singleton');
}

/**
 * Preferences are only meaningful once there is some history. Below this the UI
 * should ask for more ratings rather than showing noise.
 */
export const MIN_RATINGS_FOR_RECOMMENDATIONS = 3;

export function hasEnoughHistory(preferences: UserPreferences | undefined): boolean {
  return (preferences?.totalRatings ?? 0) >= MIN_RATINGS_FOR_RECOMMENDATIONS;
}
