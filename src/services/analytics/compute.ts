import { db } from '@/services/db';
import { MAX_SCORE, MIN_SCORE, NEUTRAL_SCORE } from '@/services/ratings/scale';
import { shrinkToBaseline } from '@/services/ratings/shrink';
import type { CoffeeBean, Rating } from '@/types';

export type AnalyticsRange = '30d' | '90d' | '1y' | 'all';

export interface CategoryMetric {
  value: string;
  /** Number of ratings — not cups, and not distinct coffees. */
  count: number;
  /** How many different coffees those ratings came from. */
  beanCount: number;
  averageScore: number;
  /**
   * `averageScore` pulled toward the user's overall average by how little
   * evidence stands behind it. What the list is ordered by, and what the bars
   * are drawn from, so that the ordering the user sees matches the length they
   * see. Shares the 1–10 scale with `averageScore`.
   */
  weightedScore: number;
}

export interface ActivityPoint {
  key: string;
  label: string;
  count: number;
  averageScore: number | null;
}

export interface AnalyticsSummary {
  range: AnalyticsRange;
  totalBeans: number;
  ratedBeans: number;
  totalRatings: number;
  averageScore: number;
  /**
   * The score that divides praise from complaint: the user's own average over
   * this range, or the middle of the scale when there is nothing to average.
   * Every category ranking is shrunk toward it.
   */
  baseline: number;
  averageScoreChange: number | null;
  topRoasters: CategoryMetric[];
  topOrigins: CategoryMetric[];
  topFlavors: CategoryMetric[];
  brewMethods: CategoryMetric[];
  roastLevels: CategoryMetric[];
  scoreHistogram: { score: number; count: number }[];
  activity: ActivityPoint[];
  activityWindowLabel: string;
  insights: string[];
}

interface Accumulator {
  count: number;
  total: number;
  beanIds: Set<string>;
}

const RANGE_DAYS: Record<Exclude<AnalyticsRange, 'all'>, number> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

function ratingTime(rating: Rating): number {
  const value = Date.parse(rating.ratedAt || rating.createdAt);
  return Number.isNaN(value) ? 0 : value;
}

function average(ratings: Rating[]): number {
  return ratings.length === 0
    ? 0
    : ratings.reduce((total, rating) => total + rating.score, 0) / ratings.length;
}

function add(
  map: Map<string, Accumulator>,
  value: string | undefined,
  score: number,
  beanId: string,
): void {
  const clean = value?.trim();
  if (!clean) return;
  const current = map.get(clean) ?? { count: 0, total: 0, beanIds: new Set<string>() };
  current.count += 1;
  current.total += score;
  current.beanIds.add(beanId);
  map.set(clean, current);
}

/**
 * Orders a category by how much the user liked it, best first.
 *
 * Returns every value rather than a top slice. The screen decides how many to
 * show, because "is that the whole list?" is a question the user can only
 * answer if the page knows what it is hiding (issue #202).
 */
function metrics(map: Map<string, Accumulator>, baseline: number): CategoryMetric[] {
  return Array.from(map.entries())
    .map(([value, item]) => {
      const averageScore = item.total / item.count;
      return {
        value,
        count: item.count,
        beanCount: item.beanIds.size,
        averageScore,
        weightedScore: shrinkToBaseline(item.count, averageScore, baseline),
      };
    })
    .sort((a, b) => b.weightedScore - a.weightedScore || b.count - a.count);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function addBucket(date: Date, weekly: boolean): Date {
  const result = new Date(date);
  if (weekly) result.setDate(result.getDate() + 7);
  else result.setMonth(result.getMonth() + 1);
  return result;
}

function bucketKey(date: Date, weekly: boolean): string {
  if (weekly) return date.toISOString().slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function activitySeries(
  ratings: Rating[],
  range: AnalyticsRange,
  now: Date,
): Pick<AnalyticsSummary, 'activity' | 'activityWindowLabel'> {
  const weekly = range === '30d' || range === '90d';
  const end = weekly ? startOfWeek(now) : startOfMonth(now);
  const bucketCount = range === '30d' ? 5 : range === '90d' ? 13 : 12;
  const start = new Date(end);
  if (weekly) start.setDate(start.getDate() - (bucketCount - 1) * 7);
  else start.setMonth(start.getMonth() - (bucketCount - 1));

  const grouped = new Map<string, Accumulator>();
  for (const rating of ratings) {
    const date = new Date(ratingTime(rating));
    const bucket = weekly ? startOfWeek(date) : startOfMonth(date);
    if (bucket < start || bucket > end) continue;
    add(grouped, bucketKey(bucket, weekly), rating.score, rating.beanId);
  }

  const activity: ActivityPoint[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addBucket(cursor, weekly)) {
    const key = bucketKey(cursor, weekly);
    const item = grouped.get(key);
    activity.push({
      key,
      label: weekly
        ? cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : cursor.toLocaleDateString('en-US', { month: 'short' }),
      count: item?.count ?? 0,
      averageScore: item ? item.total / item.count : null,
    });
  }

  return {
    activity,
    activityWindowLabel: weekly
      ? range === '30d'
        ? 'Weekly activity over the last 30 days'
        : 'Weekly activity over the last 90 days'
      : range === '1y'
        ? 'Monthly activity over the last year'
        : 'Monthly activity over the last 12 months',
  };
}

function buildInsights(
  summary: Omit<AnalyticsSummary, 'insights'>,
  previousRatings: Rating[],
): string[] {
  if (summary.totalRatings === 0) return [];

  const insights: string[] = [];
  if (summary.averageScoreChange !== null && Math.abs(summary.averageScoreChange) >= 0.25) {
    const direction = summary.averageScoreChange > 0 ? 'higher' : 'lower';
    insights.push(
      `Your average is ${Math.abs(summary.averageScoreChange).toFixed(1)} points ${direction} than the previous comparable period.`,
    );
  }

  const brew = summary.brewMethods[0];
  if (brew) {
    insights.push(
      `${brew.value} is your highest-rated brew method at ${brew.averageScore.toFixed(1)} across ${brew.count} ${brew.count === 1 ? 'rating' : 'ratings'}.`,
    );
  }

  const origin = summary.topOrigins[0];
  if (origin) {
    insights.push(
      `${origin.value} leads your origins with a ${origin.averageScore.toFixed(1)} average from ${origin.count} ${origin.count === 1 ? 'rating' : 'ratings'}.`,
    );
  }

  if (summary.brewMethods.length >= 4) {
    insights.push(
      `You used ${summary.brewMethods.length} different brew methods in this view — a broad brewing mix.`,
    );
  } else if (summary.totalRatings >= 3 && summary.brewMethods.length === 1) {
    insights.push(
      'All ratings in this view use one brew method, so trying another would add contrast.',
    );
  }

  if (previousRatings.length === 0 && summary.range !== 'all') {
    insights.push(
      'There is no earlier comparison period yet; trends will become clearer over time.',
    );
  }

  return insights.slice(0, 4);
}

export function computeAnalyticsFrom(
  beans: CoffeeBean[],
  ratings: Rating[],
  range: AnalyticsRange = 'all',
  now = new Date(),
): AnalyticsSummary {
  const beanById = new Map(beans.map((bean) => [bean.id, bean]));
  const nowTime = now.getTime();
  const days = range === 'all' ? null : RANGE_DAYS[range];
  const cutoff = days === null ? null : nowTime - days * 24 * 60 * 60 * 1000;
  const scopedRatings =
    cutoff === null ? ratings : ratings.filter((rating) => ratingTime(rating) >= cutoff);
  const previousRatings =
    cutoff === null
      ? []
      : ratings.filter((rating) => {
          const time = ratingTime(rating);
          return time >= cutoff - days! * 24 * 60 * 60 * 1000 && time < cutoff;
        });

  const roasters = new Map<string, Accumulator>();
  const origins = new Map<string, Accumulator>();
  const flavors = new Map<string, Accumulator>();
  const brews = new Map<string, Accumulator>();
  const roasts = new Map<string, Accumulator>();

  for (const rating of scopedRatings) {
    add(brews, rating.brewType, rating.score, rating.beanId);
    const bean = beanById.get(rating.beanId);
    if (!bean) continue;
    add(roasters, bean.roaster || 'Unknown roaster', rating.score, rating.beanId);
    if (bean.roastLevel && bean.roastLevel !== 'unknown') {
      add(roasts, bean.roastLevel, rating.score, rating.beanId);
    }
    for (const origin of bean.origins ?? []) {
      add(origins, origin.country, rating.score, rating.beanId);
    }
    for (const flavor of new Set((bean.tastingNotes ?? []).map((note) => note.toLowerCase()))) {
      add(flavors, flavor, rating.score, rating.beanId);
    }
  }

  const averageScore = average(scopedRatings);
  // The baseline every category is shrunk toward. With no ratings in range
  // there is no "your average" to speak of, so fall back to the middle of the
  // scale rather than to 0, which is not a score anyone can give.
  const baseline = scopedRatings.length > 0 ? averageScore : NEUTRAL_SCORE;
  const previousAverage = average(previousRatings);
  const averageScoreChange =
    days !== null && previousRatings.length > 0 ? averageScore - previousAverage : null;
  const { activity, activityWindowLabel } = activitySeries(scopedRatings, range, now);

  const base: Omit<AnalyticsSummary, 'insights'> = {
    range,
    totalBeans: beans.length,
    ratedBeans: new Set(scopedRatings.map((rating) => rating.beanId)).size,
    totalRatings: scopedRatings.length,
    averageScore,
    baseline,
    averageScoreChange,
    topRoasters: metrics(roasters, baseline),
    topOrigins: metrics(origins, baseline),
    topFlavors: metrics(flavors, baseline),
    brewMethods: metrics(brews, baseline),
    roastLevels: metrics(roasts, baseline),
    scoreHistogram: Array.from({ length: MAX_SCORE - MIN_SCORE + 1 }, (_, index) => {
      const score = MIN_SCORE + index;
      return {
        score,
        count: scopedRatings.filter((rating) => Math.round(rating.score) === score).length,
      };
    }),
    activity,
    activityWindowLabel,
  };

  return { ...base, insights: buildInsights(base, previousRatings) };
}

export async function computeAnalytics(range: AnalyticsRange = 'all'): Promise<AnalyticsSummary> {
  const [beans, ratings] = await Promise.all([db.beans.toArray(), db.ratings.toArray()]);
  return computeAnalyticsFrom(beans, ratings, range);
}
