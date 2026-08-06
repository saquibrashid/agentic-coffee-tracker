import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { refreshPreferences } from '@/services/preferences/compute';
import {
  applyJsonImportPlan,
  planJsonImport,
  type JsonImportPlan,
} from '@/services/import/jsonImport';
import {
  applyImportPlan,
  countEnrichable,
  CSV_TEMPLATE,
  ImportFormatError,
  loadExistingData,
  planCsvImport,
  type ImportIssue,
  type ImportPlan,
} from '@/services/import/ratingsImport';

type Preview =
  | { kind: 'csv'; fileName: string; plan: ImportPlan }
  | { kind: 'json'; fileName: string; plan: JsonImportPlan };

/** How many example lines to show before collapsing to a count. */
const ISSUE_PREVIEW_LIMIT = 5;

function IssueList({ title, issues, tone }: { title: string; issues: ImportIssue[]; tone: string }) {
  if (issues.length === 0) return null;
  const shown = issues.slice(0, ISSUE_PREVIEW_LIMIT);
  return (
    <div className="space-y-1">
      <h4 className={`text-sm font-medium ${tone}`}>
        {title} ({issues.length})
      </h4>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {shown.map((issue) => (
          <li key={`${issue.line}-${issue.message}`}>
            Line {issue.line}: {issue.message}
          </li>
        ))}
        {issues.length > shown.length && <li>…and {issues.length - shown.length} more.</li>}
      </ul>
    </div>
  );
}

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'coffee-import-template.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ImportPanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Defaults on: a spreadsheet almost never carries origin/process/roast, and
  // those are exactly the fields the preference engine reasons over.
  const [enrich, setEnrich] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setPreview(null);
    setError(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setStatus(null);
    setPreview(null);
    setBusy(true);

    try {
      const text = await file.text();
      // Sniff on content rather than the extension, because files renamed or
      // downloaded from a chat app routinely lose the right suffix.
      if (text.trimStart().startsWith('{')) {
        setPreview({ kind: 'json', fileName: file.name, plan: await planJsonImport(text) });
      } else {
        const existing = await loadExistingData();
        setPreview({ kind: 'csv', fileName: file.name, plan: planCsvImport(text, existing) });
      }
    } catch (err) {
      setError(
        err instanceof ImportFormatError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not read that file.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      if (preview.kind === 'csv') {
        const queued = enrich ? countEnrichable(preview.plan) : 0;
        await applyImportPlan(preview.plan, { enrich });
        setStatus(
          `Imported ${preview.plan.newRatings.length} rating${preview.plan.newRatings.length === 1 ? '' : 's'} ` +
            `across ${preview.plan.newBeans.length} new coffee${preview.plan.newBeans.length === 1 ? '' : 's'}.` +
            (queued > 0
              ? ` Looking up details for ${queued} of them in the background — check back shortly.`
              : ''),
        );
      } else {
        await applyJsonImportPlan(preview.plan);
        setStatus(
          `Restored ${preview.plan.newBeans.length} coffees, ${preview.plan.newRatings.length} ratings ` +
            `and ${preview.plan.newPhotos.length} photos.`,
        );
      }
      // Recommendations read the stored preference profile, so a bulk import
      // that did not refresh it would appear to have done nothing.
      await refreshPreferences();
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
      setBusy(false);
    }
  }

  const nothingToDo =
    preview !== null &&
    (preview.kind === 'csv'
      ? preview.plan.newRatings.length === 0 && preview.plan.newBeans.length === 0
      : preview.plan.newBeans.length === 0 &&
        preview.plan.newRatings.length === 0 &&
        preview.plan.newPhotos.length === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Bring in a rating history from a spreadsheet, or restore a backup exported above. One CSV
          row per cup you drank; coffees are grouped by roaster and name. Nothing is saved until you
          confirm the summary.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="import-file" className="sr-only">
            Choose a CSV or JSON file to import
          </label>
          <input
            id="import-file"
            ref={inputRef}
            type="file"
            accept=".csv,.json,.txt,text/csv,application/json"
            disabled={busy}
            onChange={(e) => void handleFile(e)}
            className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
          <Button variant="outline" onClick={downloadTemplate}>
            Download CSV template
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {status && (
          <p role="status" className="text-sm font-medium">
            {status}
          </p>
        )}

        {preview && (
          <div className="space-y-3 rounded-md border p-3">
            <h3 className="text-sm font-medium">Preview — {preview.fileName}</h3>

            {preview.kind === 'csv' ? (
              <>
                <ul className="space-y-0.5 text-sm">
                  <li>{preview.plan.totalRows} rows read</li>
                  <li>
                    <strong>{preview.plan.newRatings.length}</strong> ratings will be added
                  </li>
                  <li>
                    <strong>{preview.plan.newBeans.length}</strong> new coffees will be created
                  </li>
                  {preview.plan.matchedBeanCount > 0 && (
                    <li>{preview.plan.matchedBeanCount} rows matched a coffee you already have</li>
                  )}
                </ul>
                <IssueList
                  title="Skipped as already recorded"
                  issues={preview.plan.duplicates}
                  tone="text-muted-foreground"
                />
                <IssueList
                  title="Imported with an assumption"
                  issues={preview.plan.warnings}
                  tone="text-amber-600"
                />
                <IssueList
                  title="Could not import"
                  issues={preview.plan.errors}
                  tone="text-destructive"
                />
                {countEnrichable(preview.plan) > 0 && (
                  <label className="flex items-start gap-2 rounded-md bg-muted/50 p-2 text-sm">
                    <input
                      id="import-enrich"
                      type="checkbox"
                      className="mt-0.5"
                      checked={enrich}
                      onChange={(e) => setEnrich(e.target.checked)}
                    />
                    <span>
                      Look up missing details for {countEnrichable(preview.plan)} coffee
                      {countEnrichable(preview.plan) === 1 ? '' : 's'}
                      <span className="block text-xs text-muted-foreground">
                        Searches the web for origin, process, roast level and tasting notes after the
                        import finishes. Only empty fields are filled — anything in your file is kept
                        as you wrote it.
                      </span>
                    </span>
                  </label>
                )}
              </>
            ) : (
              <ul className="space-y-0.5 text-sm">
                <li>
                  <strong>{preview.plan.newBeans.length}</strong> coffees,{' '}
                  <strong>{preview.plan.newRatings.length}</strong> ratings and{' '}
                  <strong>{preview.plan.newPhotos.length}</strong> photos will be restored
                </li>
                {preview.plan.skippedBeans > 0 && (
                  <li className="text-muted-foreground">
                    {preview.plan.skippedBeans} coffees already present, left as they are
                  </li>
                )}
                {preview.plan.skippedRatings > 0 && (
                  <li className="text-muted-foreground">
                    {preview.plan.skippedRatings} ratings already present, left as they are
                  </li>
                )}
                {preview.plan.orphanedRatings > 0 && (
                  <li className="text-amber-600">
                    {preview.plan.orphanedRatings} ratings skipped — their coffee is missing
                  </li>
                )}
              </ul>
            )}

            {nothingToDo && (
              <p className="text-sm text-muted-foreground">
                There is nothing new to import from this file.
              </p>
            )}

            <div className="flex gap-2">
              <Button disabled={busy || nothingToDo} onClick={() => void handleConfirm()}>
                {busy ? 'Importing…' : 'Import'}
              </Button>
              <Button variant="outline" disabled={busy} onClick={reset}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
