import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Placeholder for the capture flow described in specs/ui.md §2 and specs/ai.md.
 * To implement: photo capture, OCR via /api/ocr, parse via /api/parse, web enrich,
 * confirmation form, save bean.
 */
export function AddCoffeePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a coffee</CardTitle>
        <CardDescription>
          Camera capture and AI extraction land here. See <code>specs/ui.md §2</code>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Not implemented yet — this is the scaffold checkpoint.
        </p>
      </CardContent>
    </Card>
  );
}
