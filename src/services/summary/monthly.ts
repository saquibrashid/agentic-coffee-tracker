import { computeAnalytics } from '@/services/analytics/compute';
import { db } from '@/services/db';

export interface MonthlySummary {
  generatedAt: string;
  month: string; // YYYY-MM
  totals: { beans: number; ratings: number; averageScore: number };
  narrative: string;
  highlights: { topRoaster?: string; topFlavor?: string };
}

function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export async function generateMonthlySummary(): Promise<MonthlySummary> {
  const a = await computeAnalytics();
  const topRoaster = a.topRoasters[0]?.value;
  const topFlavor = a.topFlavors[0]?.value;

  const narrative = a.totalRatings === 0
    ? 'No ratings recorded this month yet. Add some coffees to get a summary.'
    : `You logged ${a.totalRatings} ratings across ${a.totalBeans} beans this period with an average score of ${a.averageScore.toFixed(2)}.` +
      (topRoaster ? ` Your most-logged roaster was ${topRoaster}.` : '') +
      (topFlavor ? ` Notable flavor: ${topFlavor}.` : '');

  const summary: MonthlySummary = {
    generatedAt: new Date().toISOString(),
    month: monthKey(),
    totals: { beans: a.totalBeans, ratings: a.totalRatings, averageScore: a.averageScore },
    narrative,
    highlights: { topRoaster, topFlavor },
  };

  // Persist into meta store keyed by month
  await db.meta.put({ key: `summary-${summary.month}`, value: summary });
  return summary;
}

export async function getLatestSummary(): Promise<MonthlySummary | null> {
  const rec = await db.meta.get(`summary-${monthKey()}`);
  return (rec?.value as MonthlySummary) || null;
}
