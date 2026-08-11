/**
 * The live sync engine: one full pull -> merge -> push cycle, plus the triggers
 * and backoff around it.
 *
 * `specs/sync.md` -> The sync cycle. Order matters and is not negotiable:
 * pushing before pulling would let a device overwrite remote changes it has not
 * yet seen, which defeats the merge entirely.
 */
import { db } from '@/services/db';
import { getAuthProvider } from '@/services/auth';
import { refreshPreferences } from '@/services/preferences/compute';
import type { CoffeeBean, OutboxEntry, PhotoBlob, Rating } from '@/types';
import { NeedsUpgradeError, applyPulled } from './apply';
import {
  PhotoQuotaError,
  SyncApiError,
  SyncTimeoutError,
  deleteCloudData as deleteCloudDataRequest,
  pull,
  push,
  type PushRecord,
  type QuotaInfo,
} from './api';
import { backfillPhotos, needsBackfill, uploadPhoto } from './photos';
import {
  pendingCount,
  recordFailure,
  removeEntries,
  takeBatch,
  onEnqueue,
  clear as clearOutbox,
} from './outbox';
import {
  clearSyncState,
  getCursor,
  getDeviceId,
  getLastSyncedAt,
  setCursor,
  setLastSyncedAt,
} from './state';
import type { DeleteCloudDataResult, SyncEngine, SyncStatus } from './types';
/** `specs/sync.md` -> Backoff. Same schedule the AI queue already uses. */
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 8;

/** Transactional batches cap at 100 operations; the cursor write takes one. */
const PUSH_CHUNK = 99;

/** Guards against an unbounded loop if the server never reports `hasMore: false`. */
const MAX_PULL_PAGES = 100;

const DEBOUNCE_MS = 5_000;
const PERIODIC_MS = 5 * 60 * 1000;
const VISIBILITY_MIN_GAP_MS = 60_000;

/**
 * A status update.
 *
 * `lastError` is widened to accept an explicit `undefined` so a caller can say
 * "clear the error" in the same call that sets the new state. Under
 * `exactOptionalPropertyTypes` that is not expressible with a plain
 * `Partial<SyncStatus>`, and splitting it into two calls would publish an
 * intermediate status that never really existed.
 */
type StatusPatch = Omit<Partial<SyncStatus>, 'lastError'> & { lastError?: string | undefined };

export class CloudSyncEngine implements SyncEngine {
  #status: SyncStatus = { state: 'idle', lastSyncedAt: null, pendingCount: 0 };
  #subscribers = new Set<(status: SyncStatus) => void>();

  /** Consecutive failures, for backoff. Reset by any success. */
  #attempts = 0;
  /** Epoch ms before which a cycle is pointless. */
  #nextAttemptAt = 0;
  /** Set by a terminal failure. Only a fresh sign-in or an explicit retry clears it. */
  #halted = false;

  /** Latest known photo storage usage, reported alongside status. */
  #photoQuota: QuotaInfo | undefined;
  /**
   * Set when an upload was refused for lack of space. Ends the push loop for
   * this cycle — the refused entry stays queued, so continuing would re-take
   * the same batch and spin — but never fails the cycle.
   */
  #quotaBlocked = false;

  #running: Promise<void> | null = null;
  #started = false;
  #debounceTimer: number | undefined;
  #periodicTimer: number | undefined;
  #lastTriggeredAt = 0;
  #unsubscribeOutbox: (() => void) | undefined;

  status(): SyncStatus {
    return this.#status;
  }

  subscribe(fn: (status: SyncStatus) => void): () => void {
    this.#subscribers.add(fn);
    return () => this.#subscribers.delete(fn);
  }

  /**
   * Runs one cycle. Never rejects — failures land in `status`, because every
   * caller is a UI trigger or a browser event with nowhere to put an error.
   */
  async sync(): Promise<void> {
    // Coalesce concurrent callers within this tab. Two triggers firing at once
    // (a mutation debounce landing as the tab becomes visible) should be one
    // cycle, and the Web Lock below only arbitrates *between* tabs.
    this.#running ??= this.#runGuarded().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  /** Clears the cursor and outbox, forcing a full re-pull on the next cycle. */
  async reset(): Promise<void> {
    await clearSyncState();
    await clearOutbox();
    this.#attempts = 0;
    this.#nextAttemptAt = 0;
    this.#halted = false;
    await this.#publish({ state: 'idle', lastError: undefined });
  }

  /**
   * Erases the server-side copy, then resets local sync state.
   *
   * The reset is not optional bookkeeping. Without it the cursor still points
   * past records that no longer exist, and the next cycle would push the local
   * library straight back up — undoing the delete the user just asked for.
   *
   * Local records are deliberately untouched: this deletes the *cloud* copy.
   */
  async deleteCloudData(): Promise<DeleteCloudDataResult> {
    const userId = await requireUserId();

    // Halt first, so a cycle already scheduled cannot re-upload between the
    // delete completing and the reset landing.
    this.#halted = true;
    try {
      const result = await deleteCloudDataRequest(userId);
      await this.reset();
      this.#photoQuota = { used: 0, limit: this.#photoQuota?.limit ?? 0 };
      this.#quotaBlocked = false;
      await this.#publish({ state: 'idle', lastError: undefined });
      return result;
    } catch (err) {
      // Leave the halt in place: retrying a sync while a delete is in an
      // unknown state could re-upload data the server has partly removed.
      await this.#publish({ state: 'error', lastError: messageOf(err) });
      throw err;
    }
  }

  /**
   * Wires up the triggers from `specs/sync.md`. Idempotent, so a remount cannot
   * double-subscribe.
   */
  start(): void {
    if (this.#started) return;
    this.#started = true;

    window.addEventListener('online', this.#onOnline);
    window.addEventListener('offline', this.#onOffline);
    document.addEventListener('visibilitychange', this.#onVisibilityChange);
    // Every mutation site already enqueues; subscribing here means none of them
    // needs to also remember to poke the engine.
    this.#unsubscribeOutbox = onEnqueue(() => this.notifyMutation());
    this.#periodicTimer = window.setInterval(() => {
      // Only while the tab is visible: a background tab syncing on a timer
      // spends the user's battery and quota for a UI nobody is looking at.
      if (document.visibilityState === 'visible') void this.sync();
    }, PERIODIC_MS);

    void this.sync();
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;

    window.removeEventListener('online', this.#onOnline);
    window.removeEventListener('offline', this.#onOffline);
    document.removeEventListener('visibilitychange', this.#onVisibilityChange);
    this.#unsubscribeOutbox?.();
    this.#unsubscribeOutbox = undefined;
    if (this.#periodicTimer !== undefined) window.clearInterval(this.#periodicTimer);
    if (this.#debounceTimer !== undefined) window.clearTimeout(this.#debounceTimer);
    this.#periodicTimer = undefined;
    this.#debounceTimer = undefined;
  }

  /**
   * Called after a local mutation. Debounced, so a burst of edits — or a bulk
   * import writing hundreds of rows — produces one cycle rather than hundreds.
   */
  notifyMutation(): void {
    if (!this.#started) return;
    if (this.#debounceTimer !== undefined) window.clearTimeout(this.#debounceTimer);
    this.#debounceTimer = window.setTimeout(() => {
      this.#debounceTimer = undefined;
      void this.sync();
    }, DEBOUNCE_MS);
  }

  #onOnline = (): void => {
    // Connectivity returning is the single most likely moment for a queued
    // change to succeed, so it bypasses backoff.
    this.#nextAttemptAt = 0;
    void this.sync();
  };

  #onOffline = (): void => {
    void this.#publish({ state: 'offline' });
  };

  #onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - this.#lastTriggeredAt < VISIBILITY_MIN_GAP_MS) return;
    void this.sync();
  };

  async #runGuarded(): Promise<void> {
    if (this.#halted) return;
    if (Date.now() < this.#nextAttemptAt) return;

    if (!navigator.onLine) {
      await this.#publish({ state: 'offline' });
      return;
    }

    // Signed out is a supported way to run the app, not a degraded one, so it
    // must cost nothing and look like nothing.
    //
    // `isSyncSupported()` cannot cover this. It asks whether auth is
    // *available* in this build, which on the Standard SKU is true for every
    // visitor — including one who has never signed in. Without this check the
    // engine starts on page load, calls an endpoint that requires a principal,
    // and `#handleFailure` correctly classifies the resulting 401 as terminal:
    // the engine halts and the app shows a permanent error to someone who
    // never asked to sync. That is the "401s on a timer" the comment on
    // `isSyncSupported()` warns about but is not positioned to prevent.
    //
    // Checked per cycle rather than cached, because sign-in state changes
    // underneath a long-lived tab — a session expires, or another tab signs
    // out. `/.auth/me` is served by the platform and is cheap next to the sync
    // round trip it is gating.
    if (!(await getAuthProvider().getUser())) {
      await this.#publish({ state: 'idle', lastError: undefined });
      return;
    }

    this.#lastTriggeredAt = Date.now();

    // One sync across all open tabs, not one per tab. Same pattern the AI queue
    // runner uses; without it, N tabs would race on the same cursor.
    if (typeof navigator.locks === 'object' && navigator.locks) {
      await navigator.locks.request('coffee-sync', async () => {
        await this.#runCycle();
      });
      return;
    }
    await this.#runCycle();
  }

  async #runCycle(): Promise<void> {
    await this.#publish({ state: 'syncing', lastError: undefined });
    this.#quotaBlocked = false;

    try {
      const pulled = await this.#pullLoop();
      await this.#pushLoop();

      // Preferences are derived from beans and ratings, so a merge that changed
      // either invalidated the cached profile.
      if (pulled) await refreshPreferences();

      // Last, and deliberately outside anything that can fail the cycle: bytes
      // are cosmetic next to records, and a photo server that is down must not
      // make a fully successful record sync look broken. `backfillPhotos` is
      // written not to reject, but the guarantee is restated here rather than
      // depended upon from a distance.
      await backfillPhotos().catch(() => undefined);

      const now = new Date().toISOString();
      await setLastSyncedAt(now);
      this.#attempts = 0;
      this.#nextAttemptAt = 0;
      await this.#publish({ state: 'idle', lastSyncedAt: now, lastError: undefined });
    } catch (err) {
      await this.#handleFailure(err);
    }
  }

  /** Returns true when anything was applied locally. */
  async #pullLoop(): Promise<boolean> {
    let cursor = await getCursor();
    let changed = false;

    for (let page = 0; page < MAX_PULL_PAGES; page++) {
      const response = await pull(cursor);
      const result = await applyPulled(response.records);
      changed ||= result.touchedPreferenceInputs;

      // Persisted only after the batch is applied. Advancing first would skip
      // the whole batch permanently if the write failed.
      cursor = response.cursor;
      await setCursor(cursor);

      if (!response.hasMore) break;
    }

    return changed;
  }

  async #pushLoop(): Promise<void> {
    for (;;) {
      const entries = await takeBatch(PUSH_CHUNK);
      if (entries.length === 0) break;

      const hydrated = await this.#hydrate(entries);

      // Every entry referred to a record that is gone and was not a delete —
      // nothing to send, but the entries must still be cleared or the loop
      // would spin on them forever.
      if (hydrated.records.length === 0) {
        await removeEntries(hydrated.resolvedIds);
        if (this.#quotaBlocked) break;
        continue;
      }

      try {
        await push(await getDeviceId(), hydrated.records);
      } catch (err) {
        await recordFailure(hydrated.resolvedIds, err instanceof Error ? err.message : String(err));
        throw err;
      }

      // Applied and stale entries are both done: a stale record lost the merge,
      // and the winning version arrives on the next pull. Retrying it would
      // just lose again.
      await removeEntries(hydrated.resolvedIds);

      // A refused upload left its entry queued, so another pass would re-take
      // the same batch and refuse it again.
      if (this.#quotaBlocked) break;

      // A short batch means the outbox is drained.
      if (entries.length < PUSH_CHUNK) break;
    }
  }

  /**
   * Turns outbox entries into wire records by reading each one fresh from its
   * table, which is why entries carry no snapshot: a record edited after being
   * queued pushes its latest state, not the state it had when queued.
   */
  async #hydrate(
    entries: readonly OutboxEntry[],
  ): Promise<{ records: PushRecord[]; resolvedIds: string[] }> {
    const records: PushRecord[] = [];
    const resolvedIds: string[] = [];

    for (const entry of entries) {
      if (entry.op === 'delete') {
        resolvedIds.push(entry.id);
        records.push({
          type: entry.type,
          recordId: entry.recordId,
          // The tombstone's clock, captured at delete time because the row was
          // already gone by then.
          updatedAt: entry.deletedAt ?? entry.queuedAt,
          deleted: true,
          schemaVersion: schemaVersionFor(entry.type),
          payload: null,
        });
        continue;
      }

      const record = await this.#read(entry);
      // Queued as an upsert, but the record has since been deleted and that
      // delete has its own entry. Nothing to send.
      if (!record) {
        resolvedIds.push(entry.id);
        continue;
      }

      // Bytes before metadata (`specs/sync.md` -> Photos). The reverse order
      // publishes a pointer to bytes that do not exist, and every device that
      // pulls in that window renders a broken photo.
      if (entry.type === 'photo' && 'blob' in record) {
        const uploaded = await this.#uploadBytes(record);
        // No room server-side. The entry stays queued so the photo syncs once
        // space is freed, and the loop stops rather than re-taking it.
        if (!uploaded) {
          this.#quotaBlocked = true;
          continue;
        }
      }

      resolvedIds.push(entry.id);
      records.push({
        type: entry.type,
        recordId: entry.recordId,
        updatedAt: 'updatedAt' in record ? record.updatedAt : record.createdAt,
        deleted: false,
        schemaVersion: record.schemaVersion,
        payload: stripBlob(record),
      });
    }

    return { records, resolvedIds };
  }

  /**
   * Uploads a photo's bytes. Returns false only when the quota refused them.
   *
   * A placeholder — a photo pulled from another device whose bytes have not
   * been backfilled yet — has nothing to upload, and sending its zero bytes
   * would overwrite the real photo on the server with an empty blob.
   */
  async #uploadBytes(photo: PhotoBlob): Promise<boolean> {
    if (needsBackfill(photo)) return true;

    try {
      this.#photoQuota = await uploadPhoto(photo);
      return true;
    } catch (err) {
      if (err instanceof PhotoQuotaError) {
        this.#photoQuota = err.quota;
        return false;
      }
      throw err;
    }
  }

  async #read(entry: OutboxEntry): Promise<CoffeeBean | Rating | PhotoBlob | undefined> {
    switch (entry.type) {
      case 'bean':
        return db.beans.get(entry.recordId);
      case 'rating':
        return db.ratings.get(entry.recordId);
      case 'photo':
        return db.photos.get(entry.recordId);
    }
  }

  async #handleFailure(err: unknown): Promise<void> {
    if (err instanceof NeedsUpgradeError) {
      // Halting is mandatory. Continuing would either downgrade the record or
      // advance the cursor past it, and both lose data permanently.
      this.#halted = true;
      await this.#publish({ state: 'needs-upgrade', lastError: err.message });
      return;
    }

    // A terminal failure will fail identically forever. Retrying a 401 in a
    // loop burns the user's session and the endpoint's rate budget without ever
    // converging, so the engine stops and asks for action instead.
    if (err instanceof SyncApiError && !err.isTransient) {
      this.#halted = true;
      await this.#publish({ state: 'error', lastError: err.message });
      return;
    }

    this.#attempts += 1;

    const offline = !navigator.onLine || err instanceof SyncTimeoutError || isNetworkError(err);
    if (this.#attempts >= MAX_ATTEMPTS) {
      this.#halted = true;
      await this.#publish({
        state: 'error',
        lastError: `Sync failed ${MAX_ATTEMPTS} times. ${messageOf(err)}`,
      });
      return;
    }

    this.#nextAttemptAt =
      Date.now() + Math.min(BASE_BACKOFF_MS * 2 ** (this.#attempts - 1), MAX_BACKOFF_MS);

    // Offline is a state, not an error: local data is untouched and the app is
    // fully usable, so it must not be presented as a failure.
    await this.#publish(
      offline ? { state: 'offline' } : { state: 'error', lastError: messageOf(err) },
    );
  }

  async #publish(patch: StatusPatch): Promise<void> {
    const [pending, lastSyncedAt] = await Promise.all([
      pendingCount(),
      patch.lastSyncedAt === undefined ? getLastSyncedAt() : Promise.resolve(patch.lastSyncedAt),
    ]);

    const next: SyncStatus = {
      state: patch.state ?? this.#status.state,
      pendingCount: pending,
      lastSyncedAt,
    };

    // An explicit `lastError: undefined` clears the message, so a stale error
    // cannot outlive the failure that produced it; omitting the key entirely
    // carries the previous one forward.
    const error = 'lastError' in patch ? patch.lastError : this.#status.lastError;
    if (error !== undefined) next.lastError = error;

    if (this.#photoQuota) {
      next.photoQuota = { ...this.#photoQuota, exceeded: this.#quotaBlocked };
    }

    this.#status = next;
    for (const fn of this.#subscribers) fn(next);
  }

  /** Clears a halt after the user acts — re-authenticating, or pressing Sync now. */
  resume(): void {
    this.#halted = false;
    this.#attempts = 0;
    this.#nextAttemptAt = 0;
  }
}

/** Photo bytes travel through Blob Storage, never the record stream. */ function stripBlob(
  record: CoffeeBean | Rating | PhotoBlob,
): unknown {
  if (!('blob' in record)) return record;
  const { blob: _blob, ...rest } = record;
  return rest;
}

function schemaVersionFor(type: 'bean' | 'rating' | 'photo'): number {
  return type === 'rating' ? 2 : 1;
}

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The signed-in user's id, which the delete endpoint requires echoed back.
 *
 * Throws rather than proceeding: sending a confirmation the server cannot match
 * would fail anyway, and doing so with an empty string would be a confirmation
 * of nothing.
 */
async function requireUserId(): Promise<string> {
  const user = await getAuthProvider().getUser();
  if (!user) throw new Error('Sign in again to delete your cloud data.');
  return user.userId;
}
