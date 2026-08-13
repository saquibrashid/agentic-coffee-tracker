import { db } from '@/services/db';
import { MAX_SCORE, MIN_SCORE } from '@/services/ratings/scale';
import type { CoffeeBean, Rating } from '@/types';

export type AnalyticsRange = '30d' | '90d' | '1y' | 'all';

export interface CategoryMetric {
  value: string;
  count: number;
  averageScore: number;
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

function add(map: Map<string, Accumulator>, value: string | undefined, score: number): void {
  const clean = value?.trim();
  if (!clean) return;
  const current = map.get(clean) ?? { count: 0, total: 0 };
  current.count += 1;
  current.total += score;
  map.set(clean, current);
}

function metrics(map: Map<string, Accumulator>, limit = 8): CategoryMetric[] {
  return Array.from(map.entries())
    .map(([value, item]) => ({
      value,
      count: item.count,
      averageScore: item.total / item.count,
    }))
    .sort((a, b) => b.averageScore - a.averageScore || b.count - a.count)
    .slice(0, limit);
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
    add(grouped, bucketKey(bucket, weekly), rating.score);
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
      `${origin.value} leads your origins with a ${origin.averageScore.toFixed(1)} average from ${origin.count} ${origin.count === 1 ? 'cup' : 'cups'}.`,
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
    add(brews, rating.brewType, rating.score);
    const bean = beanById.get(rating.beanId);
    if (!bean) continue;
    add(roasters, bean.roaster || 'Unknown roaster', rating.score);
    if (bean.roastLevel && bean.roastLevel !== 'unknown') {
      add(roasts, bean.roastLevel, rating.score);
    }
    for (const origin of bean.origins ?? []) add(origins, origin.country, rating.score);
    for (const flavor of new Set((bean.tastingNotes ?? []).map((note) => note.toLowerCase()))) {
      add(flavors, flavor, rating.score);
    }
  }

  const averageScore = average(scopedRatings);
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
    averageScoreChange,
    topRoasters: metrics(roasters, 6),
    topOrigins: metrics(origins, 6),
    topFlavors: metrics(flavors, 8),
    brewMethods: metrics(brews, 8),
    roastLevels: metrics(roasts, 5),
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
