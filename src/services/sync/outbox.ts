/**
 * The local queue of changes waiting to be pushed.
 *
 * `specs/sync.md` → Dexie v3 migration. Enqueue is called from every mutation
 * site; the engine drains it during the push phase of a cycle.
 *
 * Enqueueing is intentionally cheap and never throws into the caller's path: a
 * failure to record a change for sync must not fail the user's edit. The cost
 * of that choice is that a dropped entry syncs late — on the record's next
 * edit, or on a `reset()` — rather than being lost, because upserts re-read the
 * record from its table at push time.
 */
import { ulid } from 'ulid';
import { db } from '@/services/db';
import type { OutboxEntry, SyncRecordType } from '@/types';

/**
 * Records an upsert.
 *
 * Coalesces on `[type+recordId]`: a record edited ten times between cycles
 * pushes once. The queued entry holds no snapshot, so collapsing them loses
 * nothing.
 */
export async function enqueueUpsert(type: SyncRecordType, recordId: string): Promise<void> {
  await enqueue({ type, recordId, op: 'upsert' });
}

/**
 * Records a delete.
 *
 * `deletedAt` is the tombstone's LWW clock, captured here because the row is
 * already gone from its own table by the time this is called.
 */
export async function enqueueDelete(
  type: SyncRecordType,
  recordId: string,
  deletedAt: string = new Date().toISOString(),
): Promise<void> {
  await enqueue({ type, recordId, op: 'delete', deletedAt });
}

/** Bulk form, for import and cascade-delete paths. */
export async function enqueueManyUpserts(
  type: SyncRecordType,
  recordIds: readonly string[],
): Promise<void> {
  for (const id of recordIds) await enqueueUpsert(type, id);
}

/** Bulk form, for cascade deletes. */
export async function enqueueManyDeletes(
  type: SyncRecordType,
  recordIds: readonly string[],
  deletedAt: string = new Date().toISOString(),
): Promise<void> {
  for (const id of recordIds) await enqueueDelete(type, id, deletedAt);
}

interface EnqueueInput {
  type: SyncRecordType;
  recordId: string;
  op: 'upsert' | 'delete';
  deletedAt?: string;
}

async function enqueue(input: EnqueueInput): Promise<void> {
  try {
    const existing = await db.outbox
      .where('[type+recordId]')
      .equals([input.type, input.recordId])
      .first();

    if (existing) {
      // A delete supersedes a pending upsert: the record no longer exists, so
      // there is nothing left to read at push time. The reverse also holds — an
      // upsert after a delete means the record was recreated — so the latest
      // operation always wins outright rather than being merged.
      await db.outbox.update(existing.id, (entry) => {
        entry.op = input.op;
        if (input.deletedAt) entry.deletedAt = input.deletedAt;
        else delete entry.deletedAt;
        entry.queuedAt = new Date().toISOString();
        // Reset the backoff: this is new work, not a continuation of whatever
        // was failing before.
        entry.attempts = 0;
        delete entry.lastError;
      });
      notifyEnqueued();
      return;
    }

    const entry: OutboxEntry = {
      id: ulid(),
      type: input.type,
      recordId: input.recordId,
      op: input.op,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      ...(input.deletedAt ? { deletedAt: input.deletedAt } : {}),
    };
    await db.outbox.add(entry);
    notifyEnqueued();
  } catch {
    // Deliberately swallowed. See the module comment: recording a change for
    // sync must never fail the user's edit.
  }
}

/** Oldest-first, so changes push in roughly the order they were made. */
export async function takeBatch(limit = 99): Promise<OutboxEntry[]> {
  return db.outbox.orderBy('queuedAt').limit(limit).toArray();
}

export async function pendingCount(): Promise<number> {
  return db.outbox.count();
}

export async function removeEntries(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.outbox.bulkDelete([...ids]);
}

/** Records a failed attempt so backoff can widen. */
export async function recordFailure(ids: readonly string[], message: string): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    for (const id of ids) {
      const entry = await db.outbox.get(id);
      if (!entry) continue;
      await db.outbox.update(id, { attempts: entry.attempts + 1, lastError: message });
    }
  });
}

/** Clears the queue. Used by `SyncEngine.reset()`. */
export async function clear(): Promise<void> {
  await db.outbox.clear();
}

/**
 * Notified whenever an entry is queued.
 *
 * A registry rather than a direct call into the engine, because the engine
 * imports this module — calling back the other way would be a cycle. It also
 * keeps mutation sites unaware of whether an engine exists at all: they enqueue
 * and move on.
 */
const listeners = new Set<() => void>();

export function onEnqueue(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyEnqueued(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // Same contract as the enqueue itself: a sync trigger must never fail the
      // user's edit.
    }
  }
}
