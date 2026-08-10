import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/services/db';
import { exportCsv, exportJson, exportJsonWithPhotos } from '@/services/export/exporter';
import { ImportPanel } from './ImportPanel';
import { AccountPanel } from './AccountPanel';
import { AppearancePanel } from './AppearancePanel';
import { SyncPanel } from './SyncPanel';
import {
  RESET_CONFIRMATION_PHRASE,
  formatBytes,
  getStorageEstimate,
  resetAllData,
  type StorageEstimateSummary,
} from '@/services/storage/reset';

const TASK_LABELS: Record<string, string> = {
  ocr: 'Reading a bag photo',
  'llm-parse': 'Reading a bag photo',
  'web-enrich': 'Looking up details',
  recommendation: 'Refreshing recommendations',
};

export function SettingsPage() {
  const pending = useLiveQuery(() => db.pendingAiTasks.toArray(), []) ?? [];
  // A bulk import can queue one task per coffee, so "web-enrich ×40" with no
  // names would be unreadable. Resolve each task back to the coffee it is for.
  const beanNames =
    useLiveQuery(async () => {
      const beans = await db.beans.toArray();
      return new Map(beans.map((bean) => [bean.id, `${bean.roaster} — ${bean.name}`]));
    }, []) ?? new Map<string, string>();

  function describeTask(task: { type: string; beanId?: string }): string {
    const label = TASK_LABELS[task.type] ?? task.type;
    const bean = task.beanId ? beanNames.get(task.beanId) : undefined;
    return bean ? `${label} — ${bean}` : label;
  }

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
      <AccountPanel />
      <SyncPanel />
      <AppearancePanel />

      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void exportCsv()}>
            Export CSV
          </Button>
          <Button variant="outline" onClick={() => void exportJson()}>
            Export JSON
          </Button>
          <Button variant="outline" onClick={() => void exportJsonWithPhotos()}>
            Export JSON + photos
          </Button>
        </CardContent>
      </Card>

      <ImportPanel />

      <Card>
        <CardHeader>
          <CardTitle>Pending AI operations ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 && (
            <p className="text-muted-foreground text-sm">No pending operations.</p>
          )}
          <ul className="space-y-2">
            {pending.map((t) => (
              <li key={t.id} className="rounded border p-2 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{describeTask(t)}</div>
                    <div className="text-muted-foreground text-xs">
                      attempts: {t.attempts}{' '}
                      {t.nextAttemptAt
                        ? `· next: ${new Date(t.nextAttemptAt).toLocaleString()}`
                        : ''}
                    </div>
                    {t.lastError && <div className="text-xs text-red-600">{t.lastError}</div>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => void retryTask(t.id)}>
                      Retry
                    </Button>
                    <Button variant="outline" onClick={() => void cancelTask(t.id)}>
                      Cancel
                    </Button>
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

      <DangerZone />
    </div>
  );
}

function DangerZone() {
  const [estimate, setEstimate] = useState<StorageEstimateSummary | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshEstimate = useCallback(() => {
    void getStorageEstimate().then(setEstimate);
  }, []);

  useEffect(refreshEstimate, [refreshEstimate]);

  const unlocked = confirmation.trim().toUpperCase() === RESET_CONFIRMATION_PHRASE;

  async function handleReset() {
    setBusy(true);
    setStatus('Deleting local data…');
    const result = await resetAllData();
    if (result.errors.length > 0) {
      // Surface the failure instead of reloading, otherwise the user would see
      // a seemingly-clean app and never learn that some data survived.
      setStatus(`Reset incomplete: ${result.errors.join('; ')}. Try again.`);
      setBusy(false);
      setConfirmation('');
      refreshEstimate();
      return;
    }
    setStatus('Local data deleted. Reloading…');
    window.location.href = '/';
  }

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Storage used</h3>
          <p className="text-muted-foreground text-sm">
            {estimate === null
              ? 'Checking…'
              : estimate.supported
                ? `${formatBytes(estimate.usageBytes)} of ${formatBytes(estimate.quotaBytes)} available`
                : 'Your browser does not report storage usage.'}
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Delete all data</h3>
          <p className="text-muted-foreground text-sm">
            This permanently removes every coffee, rating and photo from this device, along with
            cached files and the offline service worker. If you are signed in, the cloud copy is
            left alone and will sync back — use <strong>Delete cloud data</strong> above first if
            you want it gone everywhere.
          </p>
          <label htmlFor="reset-confirm" className="block text-sm font-medium">
            Type <code>{RESET_CONFIRMATION_PHRASE}</code> to confirm
          </label>
          <input
            id="reset-confirm"
            type="text"
            autoComplete="off"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            disabled={busy}
            className="border-input bg-background focus-visible:ring-ring h-10 w-full max-w-xs rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
          />
          <div>
            <Button
              variant="destructive"
              disabled={!unlocked || busy}
              onClick={() => void handleReset()}
            >
              Delete all data
            </Button>
          </div>
          {status && (
            <p role="status" className="text-destructive text-sm">
              {status}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
