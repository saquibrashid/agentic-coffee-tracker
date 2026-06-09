import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function AnalyticsPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analytics</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Recharts widgets per <code>specs/ui.md §5</code>. Lazy-loaded in production.
        </p>
      </CardContent>
    </Card>
  );
}
