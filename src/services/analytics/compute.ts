import { db } from '@/services/db';

export interface AnalyticsSummary {
  totalBeans: number;
  totalRatings: number;
  averageScore: number;
  topRoasters: { value: string; count: number; averageScore: number }[];
  topFlavors: { value: string; count: number }[];
  scoreHistogram: { score: number; count: number }[];
}

export async function computeAnalytics(): Promise<AnalyticsSummary> {
  const beans = await db.beans.toArray();
  const ratings = await db.ratings.toArray();

  const totalBeans = beans.length;
  const totalRatings = ratings.length;
  const averageScore =
    totalRatings === 0 ? 0 : ratings.reduce((s, r) => s + (r.score || 0), 0) / totalRatings;

  const roasterMap = new Map<string, { count: number; total: number }>();
  for (const b of beans) {
    const r = b.roaster || 'Unknown';
    const beanRatings = ratings.filter((rt) => rt.beanId === b.id);
    const cur = roasterMap.get(r) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += beanRatings.reduce((s, x) => s + (x.score || 0), 0);
    roasterMap.set(r, cur);
  }
  const topRoasters = Array.from(roasterMap.entries())
    .map(([value, v]) => ({ value, count: v.count, averageScore: v.count ? v.total / v.count : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const flavorMap = new Map<string, number>();
  for (const b of beans) {
    for (const n of b.tastingNotes || []) {
      flavorMap.set(n, (flavorMap.get(n) || 0) + 1);
    }
  }
  const topFlavors = Array.from(flavorMap.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const scoreHistogram = [1, 2, 3, 4, 5].map((score) => ({
    score,
    count: ratings.filter((r) => Math.round(r.score) === score).length,
  }));

  return { totalBeans, totalRatings, averageScore, topRoasters, topFlavors, scoreHistogram };
}
