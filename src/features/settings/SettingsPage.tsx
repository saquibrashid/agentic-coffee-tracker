import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function SettingsPage() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" disabled>Export CSV</Button>
          <Button variant="outline" disabled>Export JSON</Button>
          <Button variant="outline" disabled>Export JSON + photos (zip)</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            See <code>specs/ui.md §7</code>. Pending operations, storage usage, and reset land here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
