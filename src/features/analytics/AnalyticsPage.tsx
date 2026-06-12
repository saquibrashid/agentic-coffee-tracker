import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useEffect, useState } from 'react';
import { computeAnalytics, type AnalyticsSummary } from '@/services/analytics/compute';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsSummary | null>(null);

  useEffect(() => {
    void computeAnalytics().then(setData);
  }, []);

  if (!data) return <p>Loading analytics…</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Beans: {data.totalBeans}</p>
          <p>Ratings: {data.totalRatings}</p>
          <p>Average score: {data.averageScore.toFixed(2)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Score distribution</CardTitle>
        </CardHeader>
        <CardContent style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.scoreHistogram}>
              <XAxis dataKey="score" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top roasters</CardTitle>
        </CardHeader>
        <CardContent>
          <ul>
            {data.topRoasters.map((r) => (
              <li key={r.value} className="text-sm">
                {r.value} — {r.count} beans (avg {r.averageScore.toFixed(2)})
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top flavors</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-2">
            {data.topFlavors.map((f) => (
              <li key={f.value} className="rounded bg-muted px-2 py-1 text-xs">
                {f.value} ({f.count})
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
