/**
 * Derives `UserPreferences` from the local ratings history (specs/data-model.md).
 *
 * Ranking shrinks each value's average toward the user's own overall average, by
 * an amount that depends on how few ratings stand behind it. The point is to
 * hold back a single top-marks cup without ever letting volume decide the order:
 * shrinkage can only pull a value *toward* the mean, never past it, so something
 * the user scores below their own average can never outrank something they score
 * above it, however often they drink it.
 *
 * This replaced `averageScore * log2(1 + count)`, which multiplied the score by a
 * count term and so ranked partly by frequency. It read as a bug because it is
 * one: a note averaging 6.5 across 8 cups outranked one averaging 9.0 across 2,
 * on a screen whose heading is "Your taste map" (issue #199). Using a raw average
 * on a 1–10 scale made it worse, because every rating then contributes
 * positively — a coffee rated 2/10 still pushed its notes *up* the list.
 *
 * Everything is computed locally — preferences never leave the device except as
 * the small, anonymous summary sent to `/api/recommend`.
 */
import { NEUTRAL_SCORE } from '@/services/ratings/scale';
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

/**
 * A value must have at least this many rated cups before it can be ranked.
 *
 * One is enough because shrinkage, not this threshold, is what stops a lone cup
 * dominating: a single rating is pulled most of the way back to the baseline.
 */
const MIN_OBSERVATIONS = 1;
const TOP_N = 5;

/**
 * How many ratings' worth of "you are probably average at this" to assume before
 * believing a value's own average.
 *
 * At `PRIOR_STRENGTH` observations the ranked score sits halfway between the
 * user's overall average and what this value actually scored. Five is a
 * deliberate choice for a hobby history measured in dozens of cups, not
 * thousands: it leaves a 2-cup note visibly hedged and lets a 12-cup one speak
 * almost for itself.
 */
const PRIOR_STRENGTH = 5;

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

function rank<T extends string>(map: Map<string, Accumulator>, baseline: number): RankedItem<T>[] {
  return Array.from(map.entries())
    .filter(([, acc]) => acc.count >= MIN_OBSERVATIONS)
    .map(([value, acc]) => {
      const averageScore = acc.total / acc.count;
      return {
        value: value as T,
        count: acc.count,
        averageScore,
        // Still called `weightedScore` because it is the persisted field name,
        // but it now shares the 1–10 scale with `averageScore` — it is that
        // average pulled toward the baseline, not a score times a count.
        weightedScore:
          (acc.count * averageScore + PRIOR_STRENGTH * baseline) / (acc.count + PRIOR_STRENGTH),
      };
    })
    .sort((a, b) => b.weightedScore - a.weightedScore || b.count - a.count)
    .slice(0, TOP_N);
}

export function computePreferencesFrom(beans: CoffeeBean[], ratings: Rating[]): UserPreferences {
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

  // What a coffee scores absent any other signal. Ranking is relative to the
  // user's own centre of gravity, not the scale's midpoint: someone who averages
  // 8.5 is telling you something different by a 7 than someone who averages 6.
  const baseline = ratings.length === 0 ? NEUTRAL_SCORE : scoreTotal / ratings.length;

  return {
    id: 'singleton',
    schemaVersion: 1,
    computedAt: new Date().toISOString(),
    favoriteOrigins: rank<string>(origins, baseline),
    favoriteRoasters: rank<string>(roasters, baseline),
    favoriteProcesses: rank<Process>(processes, baseline),
    favoriteRoastLevels: rank<RoastLevel>(roastLevels, baseline),
    favoriteFlavors: rank<string>(flavors, baseline),
    favoriteBrewTypes: rank<BrewType>(brewTypes, baseline),
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
