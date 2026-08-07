import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import {
  generateMonthlySummary,
  getLatestSummary,
  type MonthlySummary,
} from '@/services/summary/monthly';

export function SummaryPage() {
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void getLatestSummary().then(setSummary);
  }, []);

  async function regenerate() {
    setLoading(true);
    try {
      const s = await generateMonthlySummary();
      setSummary(s);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly summary</CardTitle>
      </CardHeader>
      <CardContent>
        {summary ? (
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">For {summary.month}</p>
            <p>{summary.narrative}</p>
            <p className="text-sm">
              Highlights: {summary.highlights.topRoaster || '—'} ·{' '}
              {summary.highlights.topFlavor || '—'}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No summary yet for this month.</p>
        )}
        <div className="mt-3">
          <Button onClick={() => void regenerate()} disabled={loading}>
            {loading ? 'Generating…' : 'Generate / regenerate'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
