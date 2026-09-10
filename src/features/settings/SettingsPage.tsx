import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CollapsibleCard, CollapsibleCardHeadingLevel } from '@/components/ui/collapsible-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/services/db';
import { beanNeedsEnrichment } from '@/services/enrich/autoEnrich';
import {
  LAST_RELOOKUP_KEY,
  LAST_RELOOKUP_QUEUED_KEY,
  describeTally,
  tallyLookups,
} from '@/services/enrich/lookupOutcome';
import { exportCsv, exportJson, exportJsonWithPhotos } from '@/services/export/exporter';
import { ImportPanel } from './ImportPanel';
import { AccountPanel } from './AccountPanel';
import { AppearancePanel } from './AppearancePanel';
import { SampleDataPanel } from './SampleDataPanel';
import { WalkthroughPanel } from '@/features/onboarding/WalkthroughPanel';
import { FeedbackPanel } from '@/features/feedback/FeedbackPanel';
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
  'studio-photo': 'Re-shooting a bag photo',
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
    <div className="space-y-6">
      <SettingsGroup title="Account &amp; sync">
        <AccountPanel />
        <SyncPanel />
      </SettingsGroup>

      <SettingsGroup title="Your coffees">
        <ImportPanel />
        <CollapsibleCard title="Export" hint="Take a copy of everything out">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void exportCsv()}>
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => void exportJson()}>
              Export JSON
            </Button>
            <Button variant="outline" onClick={() => void exportJsonWithPhotos()}>
              Export JSON + photos
            </Button>
          </div>
        </CollapsibleCard>
        <SampleDataPanel />
      </SettingsGroup>

      <SettingsGroup title="AI tools">
        <RelookupPanel />
        <StudioPhotoPanel />
        <CollapsibleCard
          title="Pending AI operations"
          hint={
            pending.length === 0
              ? 'Nothing running'
              : `${pending.length} ${pending.length === 1 ? 'operation' : 'operations'} waiting`
          }
          {...(pending.length > 0
            ? {
                attention: `${pending.length} ${pending.length === 1 ? 'operation is' : 'operations are'} still running`,
              }
            : {})}
        >
          <>
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
          </>
        </CollapsibleCard>
      </SettingsGroup>

      <SettingsGroup title="App">
        <AppearancePanel />
        <WalkthroughPanel />
        <FeedbackPanel />
      </SettingsGroup>

      {/*
        Outside every group and last, with no heading over it. Grouping exists
        to help the eye land somewhere; this is the one section nobody should
        land on by accident.
      */}
      <DangerZone />
    </div>
  );
}

/**
 * A titled run of collapsed sections.
 *
 * Twelve cards in a flat list gave no way to know what the page held without
 * scrolling the whole thing. Collapsing them makes it scannable; grouping is
 * what makes the scan mean something, by turning twelve equal rows into four
 * short lists with a subject each.
 *
 * The heading is `h2` because each `CollapsibleCard` inside drops to `h3` via
 * `CollapsibleCardHeadingLevel`. A section must not outrank the heading it sits
 * beneath, or the outline every screen reader announces comes out inverted.
 */
function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground px-1 text-xs font-medium tracking-wide uppercase">
        {title}
      </h2>
      <CollapsibleCardHeadingLevel level="h3">{children}</CollapsibleCardHeadingLevel>
    </section>
  );
}

function RelookupPanel() {
  const beans = useLiveQuery(async () => db.beans.toArray(), []);
  const incomplete = (beans ?? []).filter(
    (bean) => !bean.isArchived && beanNeedsEnrichment(bean),
  ).length;

  // Both halves of the report come from the database, not from component state,
  // which is the whole point of #246: the old status line was `useState` and so
  // was destroyed the moment the user navigated away to look at the queue.
  const lastRun = useLiveQuery(async () => {
    const [startedAt, queued] = await Promise.all([
      db.meta.get(LAST_RELOOKUP_KEY),
      db.meta.get(LAST_RELOOKUP_QUEUED_KEY),
    ]);
    return {
      startedAt: typeof startedAt?.value === 'string' ? startedAt.value : null,
      queued: typeof queued?.value === 'number' ? queued.value : 0,
    };
  }, []);

  const report = describeTally(
    tallyLookups(beans ?? [], lastRun?.startedAt ?? null, lastRun?.queued ?? 0),
  );

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRelookup() {
    setBusy(true);
    setError(null);
    try {
      const { relookupIncompleteBeans } = await import('@/services/enrich/relookup');
      await relookupIncompleteBeans();
      const mod = await import('@/services/queue/queueRunner');
      await mod.runQueueNow();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue the lookups.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <CollapsibleCard
      title="Fill in missing details"
      hint={
        incomplete === 0
          ? 'Every coffee has its details filled in'
          : `${incomplete} ${incomplete === 1 ? 'coffee is' : 'coffees are'} missing something`
      }
      {...(incomplete > 0
        ? {
            attention: `${incomplete} ${incomplete === 1 ? 'coffee is' : 'coffees are'} missing details`,
          }
        : {})}
    >
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          {incomplete === 0 ? (
            'Every coffee has its details filled in.'
          ) : (
            <>
              <Link to="/beans?incomplete=1" className="underline underline-offset-2">
                {incomplete} {incomplete === 1 ? 'coffee is' : 'coffees are'}
              </Link>{' '}
              missing a roast level, process, origin, tasting notes or photo. Searching the
              roaster&rsquo;s store again can fill them in.
            </>
          )}
        </p>
        <p className="text-muted-foreground text-xs">
          Worth retrying if you imported coffees with shortened names — a lookup that found nothing
          before is not tried again on its own.
        </p>
        <Button disabled={busy || incomplete === 0} onClick={() => void handleRelookup()}>
          {busy ? 'Queueing…' : 'Look up missing details'}
        </Button>
        {report && (
          <p className="text-sm" role="status">
            {report}
          </p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    </CollapsibleCard>
  );
}

/**
 * Re-shooting a whole library as studio product shots.
 *
 * The one operation in this app that spends money per item, which is why it
 * looks different from its neighbour above. Nothing is queued on its own: the
 * count is stated before the button is pressed and it is the exact number of
 * images that will be generated, because a rounded-up "about 40" would be a bill
 * nobody agreed to. The queue then runs them one at a time, in the open, where
 * they can be cancelled.
 */
function StudioPhotoPanel() {
  const reshootable =
    useLiveQuery(async () => {
      const { countReshootableBeans } = await import('@/services/enrich/studioPhoto');
      return countReshootableBeans();
    }, []) ?? 0;
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleQueue() {
    setBusy(true);
    setStatus(null);
    try {
      const { queueStudioPhotos } = await import('@/services/enrich/studioPhoto');
      const result = await queueStudioPhotos();
      const mod = await import('@/services/queue/queueRunner');
      await mod.runQueueNow();

      setStatus(
        result.queued === 0
          ? 'Nothing new to re-shoot — every eligible coffee is already queued.'
          : `Queued ${result.queued} ${result.queued === 1 ? 'photo' : 'photos'}. They run in the background, one at a time, and each one can be undone from the coffee's page.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not queue the re-shoots.');
    } finally {
      setConfirming(false);
      setBusy(false);
    }
  }

  return (
    // No attention dot, deliberately: this is the one operation that costs
    // money per photo, and a dot would read as the app asking to spend it.
    <CollapsibleCard
      title="Studio photos"
      hint={
        reshootable === 0
          ? 'Every coffee with a photo has been re-shot'
          : `${reshootable} ${reshootable === 1 ? 'photo has' : 'photos have'} not been re-shot`
      }
    >
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          {reshootable === 0
            ? 'Every coffee with a photo has already been re-shot.'
            : `${reshootable} ${reshootable === 1 ? 'coffee has a photo that has' : 'coffees have photos that have'} not been re-shot. A model re-photographs the bag as a studio product shot, keeping the packaging and changing only the lighting and angle.`}
        </p>
        <p className="text-muted-foreground text-xs">
          Each photo costs money to generate and the model can get a label subtly wrong, so the
          result is decoration only — your original is kept, details are never read off a generated
          photo, and any coffee can be put back from its own page.
        </p>
        {confirming ? (
          <div className="space-y-2">
            <p className="text-sm">
              This will generate {reshootable} {reshootable === 1 ? 'image' : 'images'}, one for
              each of those coffees. Carry on?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void handleQueue()}>
                {busy ? 'Queueing…' : `Generate ${reshootable}`}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            disabled={busy || reshootable === 0}
            onClick={() => setConfirming(true)}
          >
            Re-shoot every bag photo
          </Button>
        )}
        {status && <p className="text-sm">{status}</p>}
      </div>
    </CollapsibleCard>
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
    <CollapsibleCard
      title="Danger zone"
      className="border-destructive/50"
      hint={
        estimate === null
          ? 'Storage and deleting everything on this device'
          : estimate.supported
            ? `Using ${formatBytes(estimate.usageBytes)} on this device`
            : 'Deleting everything on this device'
      }
    >
      <div className="space-y-4">
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
          <Label htmlFor="reset-confirm" className="block">
            Type <code>{RESET_CONFIRMATION_PHRASE}</code> to confirm
          </Label>
          <Input
            id="reset-confirm"
            type="text"
            autoComplete="off"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            disabled={busy}
            className="max-w-xs"
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
      </div>
    </CollapsibleCard>
  );
}
