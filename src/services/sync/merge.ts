/**
 * Last-write-wins conflict resolution.
 *
 * Specified by `specs/sync.md` → Conflict policy. Kept pure and dependency-free
 * so the identical rule can be unit-tested in isolation and applied on both
 * sides of the wire: the client uses it when merging a pull, the server uses
 * the same comparison when accepting a push.
 */

import type { SyncRecordType } from '@/types';

/** The version of each record type this build understands. */
export const SUPPORTED_SCHEMA_VERSIONS: Record<SyncRecordType, number> = {
  bean: 1,
  rating: 2,
  photo: 1,
};

/** The minimum a record needs for a merge decision. */
export interface Mergeable {
  /**
   * ISO 8601 UTC. `data-model.md` mandates `new Date().toISOString()`, which is
   * fixed-width and UTC, so lexicographic order equals chronological order and
   * no parsing is required.
   */
  updatedAt: string;
  schemaVersion: number;
}

export type MergeDecision =
  /** Incoming is newer. Write it. */
  | { outcome: 'apply' }
  /** Existing is newer or equal. Keep it. */
  | { outcome: 'stale' }
  /**
   * Incoming was written by a newer build than this one. The caller must halt
   * the cycle and surface `needs-upgrade` rather than write anything.
   */
  | { outcome: 'needs-upgrade'; incomingVersion: number; supportedVersion: number };

/**
 * Decides whether `incoming` should replace `existing`.
 *
 * `existing` is `null` when the record is new locally, which always applies —
 * subject to the schema guard, which runs first and unconditionally.
 */
export function resolve(
  type: SyncRecordType,
  incoming: Mergeable,
  existing: Mergeable | null,
): MergeDecision {
  const supported = SUPPORTED_SCHEMA_VERSIONS[type];

  // The guard runs before the clock comparison on purpose. A record from a
  // newer build is not merely unwanted, it is unreadable: applying it would
  // silently downgrade fields this build cannot represent. This mirrors the
  // meta.dbSchemaVersion boot gate in architecture.md -> IndexedDB & Migrations,
  // where a stale client must degrade loudly rather than corrupt data.
  if (incoming.schemaVersion > supported) {
    return {
      outcome: 'needs-upgrade',
      incomingVersion: incoming.schemaVersion,
      supportedVersion: supported,
    };
  }

  if (existing === null) return { outcome: 'apply' };

  // Strictly greater. An exact tie keeps the existing record, which makes the
  // operation idempotent: re-pushing an unchanged record is a guaranteed no-op,
  // and that is what makes retry-on-timeout safe.
  return incoming.updatedAt > existing.updatedAt ? { outcome: 'apply' } : { outcome: 'stale' };
}

/**
 * The LWW clock for a record.
 *
 * `PhotoBlob` has no `updatedAt` because photo bytes are immutable — a photo
 * ULID never changes content (`specs/sync.md` → Blob Storage), so there is no
 * conflict to resolve beyond presence. `createdAt` is therefore both its
 * creation time and its only clock.
 */
export function clockOf(record: { updatedAt?: string; createdAt: string }): string {
  return record.updatedAt ?? record.createdAt;
}
