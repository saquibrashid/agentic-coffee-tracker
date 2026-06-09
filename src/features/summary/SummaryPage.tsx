import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function SummaryPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly summary</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Narrative + deterministic stats per <code>specs/ui.md §6</code>.
        </p>
      </CardContent>
    </Card>
  );
}
