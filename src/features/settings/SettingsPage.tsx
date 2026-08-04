import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/services/db';
import { exportCsv, exportJson, exportJsonWithPhotos } from '@/services/export/exporter';

export function SettingsPage() {
  const pending = useLiveQuery(() => db.pendingAiTasks.toArray(), []) ?? [];

  async function retryTask(id: string) {
    // Callback form so the backoff timestamp is removed rather than set to
    // undefined — the task becomes eligible on the next queue pass.
    await db.pendingAiTasks.update(id, (draft) => {
      delete draft.nextAttemptAt;
      delete draft.lastError;
      draft.attempts = 0;
    });
  }
  async function cancelTask(id: string) {
    await db.pendingAiTasks.delete(id);
  }
  async function runQueueNow() {
    const mod = await import('@/services/queue/queueRunner');
    await mod.runQueueNow();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void exportCsv()}>Export CSV</Button>
          <Button variant="outline" onClick={() => void exportJson()}>Export JSON</Button>
          <Button variant="outline" onClick={() => void exportJsonWithPhotos()}>Export JSON + photos</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending AI operations ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 && <p className="text-sm text-muted-foreground">No pending operations.</p>}
          <ul className="space-y-2">
            {pending.map((t) => (
              <li key={t.id} className="rounded border p-2 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{t.type}</div>
                    <div className="text-xs text-muted-foreground">
                      attempts: {t.attempts} {t.nextAttemptAt ? `· next: ${new Date(t.nextAttemptAt).toLocaleString()}` : ''}
                    </div>
                    {t.lastError && <div className="text-xs text-red-600">{t.lastError}</div>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => void retryTask(t.id)}>Retry</Button>
                    <Button variant="outline" onClick={() => void cancelTask(t.id)}>Cancel</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Button onClick={() => void runQueueNow()}>Run queue now</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            See <code>specs/ui.md §7</code>. Storage usage and reset land here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
