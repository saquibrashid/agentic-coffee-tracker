import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { db } from '@/services/db';
import { loadSampleData, removeSampleData } from '@/services/sample/sampleData';

/**
 * Loading and clearing the sample library.
 *
 * Analytics, "For you" and the predictor each need a dozen ratings before they
 * say anything, so a new user meets three empty screens and no reason to
 * believe they will ever be interesting. This fills them with a made-up palate
 * so the app can be seen working before anyone has invented twelve coffees they
 * have not drunk (#241).
 *
 * The counts are read live rather than assumed, so the card always describes
 * what is actually in the database — including after a reset, or on a second
 * device where the samples were never loaded (they are deliberately not synced).
 */
export function SampleDataPanel() {
  const sampleBeans =
    useLiveQuery(() => db.beans.filter((b) => b.isSample === true).count(), []) ?? 0;
  const realRatings =
    useLiveQuery(() => db.ratings.filter((r) => r.isSample !== true).count(), []) ?? 0;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const loaded = sampleBeans > 0;

  async function handleLoad() {
    setBusy(true);
    setStatus(null);
    try {
      await loadSampleData();
      setStatus(
        'Sample coffees added. Analytics, For you and Check now have something to work with.',
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not add the sample coffees.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setStatus(null);
    try {
      const removed = await removeSampleData();
      setStatus(`Removed ${removed} sample ${removed === 1 ? 'record' : 'records'}.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not remove the sample coffees.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sample coffees</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">
          {loaded
            ? `${sampleBeans} sample coffees are loaded. They are made up, so remove them once you have rated a few of your own.`
            : 'Analytics, For you and Check only say something once you have rated a few coffees. Load a small set of made-up ones to see how all three work before you have your own history.'}
        </p>
        <p className="text-muted-foreground text-xs">
          Sample coffees never sync to your other devices and are left out of every export, so they
          cannot end up in a backup. Removing them takes them out in one go and leaves anything you
          added yourself untouched.
        </p>

        {loaded && realRatings > 0 && (
          <p className="text-sm font-medium">
            You have rated {realRatings} {realRatings === 1 ? 'coffee' : 'coffees'} of your own now.
            Removing the samples will make Analytics and For you reflect only your taste.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {loaded ? (
            <Button variant="outline" disabled={busy} onClick={() => void handleRemove()}>
              {busy ? 'Removing…' : 'Remove sample coffees'}
            </Button>
          ) : (
            <Button variant="outline" disabled={busy} onClick={() => void handleLoad()}>
              {busy ? 'Adding…' : 'Load sample coffees'}
            </Button>
          )}
        </div>

        {status && (
          <p className="text-sm" role="status">
            {status}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
