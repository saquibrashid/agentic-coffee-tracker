/**
 * Settings → Sync (`specs/sync.md` → UI).
 *
 * Sync is the one feature that moves a user's data off their device, so this
 * panel's job is less "expose controls" than "make the current situation
 * legible": who is signed in, whether anything is waiting, how much storage is
 * used, and how to take it all back down again.
 */
import { useCallback, useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthUser } from '@/services/auth';
import { isSyncSupported } from '@/services/sync';
import { getSyncEngine } from '@/services/sync';
import { useSyncStatus } from '@/services/sync/useSyncStatus';
import { formatBytes } from '@/services/storage/reset';
import { DELETE_CLOUD_PHRASE, describeSync } from './syncCopy';

export function SyncPanel() {
  const { user } = useAuthUser();
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-render on a timer so "Synced 2 minutes ago" does not sit at "just now"
  // for an hour. Cheap, and only while this panel is on screen.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const syncNow = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const engine = getSyncEngine();
    // A halted engine ignores sync(); pressing the button is exactly the
    // deliberate user action that should clear the halt.
    if ('resume' in engine && typeof engine.resume === 'function') {
      (engine as { resume: () => void }).resume();
    }
    await engine.sync({ force: true });
    setBusy(false);
  }, []);

  const deleteCloud = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await getSyncEngine().deleteCloudData();
      setMessage(
        `Deleted ${result.recordsDeleted} record${result.recordsDeleted === 1 ? '' : 's'} and ` +
          `${result.photosDeleted} photo${result.photosDeleted === 1 ? '' : 's'} from the cloud. ` +
          'Everything on this device is untouched.',
      );
      setConfirmation('');
    } catch (err) {
      // Never silently swallowed: failing to delete data someone asked to have
      // deleted, while telling them it worked, is the worst outcome here.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  // Nothing honest to say in a build that cannot sync, and an explanation
  // nobody asked for is noise.
  if (!isSyncSupported()) return null;

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sync</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Sign in above to use the same coffees on more than one device. Your beans, ratings and
            photos are copied to the cloud; everything derived from them — preferences, summaries,
            recommendations — is recalculated on each device and never uploaded.
          </p>
        </CardContent>
      </Card>
    );
  }

  const quota = status.photoQuota;
  const unlocked = confirmation.trim().toUpperCase() === DELETE_CLOUD_PHRASE;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p role="status" className="text-sm">
            {describeSync(status)}
          </p>
          <Button variant="outline" disabled={busy} onClick={() => void syncNow()}>
            {status.state === 'syncing' ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>

        {quota && (
          <div>
            <h3 className="text-sm font-medium">Photo storage</h3>
            <p className="text-muted-foreground text-sm">
              {formatBytes(quota.used)} of {formatBytes(quota.limit)} used
              {quota.exceeded && ' — full. Delete some photos to sync the rest.'}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-destructive text-sm font-medium">Delete cloud data</h3>
          <p className="text-muted-foreground text-sm">
            Removes every coffee, rating and photo this app has stored in the cloud for your
            account. Nothing on this device is deleted — but with the cloud copy gone, your other
            devices will keep only what they already hold.
          </p>
          <Label htmlFor="delete-cloud-confirm" className="block">
            Type <code>{DELETE_CLOUD_PHRASE}</code> to confirm
          </Label>
          <Input
            id="delete-cloud-confirm"
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
              onClick={() => void deleteCloud()}
            >
              Delete cloud data
            </Button>
          </div>
        </div>

        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
