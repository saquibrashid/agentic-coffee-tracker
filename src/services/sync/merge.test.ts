import { describe, expect, it } from 'vitest';

import { SUPPORTED_SCHEMA_VERSIONS, clockOf, resolve, type Mergeable } from './merge';

function at(iso: string, schemaVersion = 1): Mergeable {
  return { updatedAt: iso, schemaVersion };
}

const EARLIER = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-02T00:00:00.000Z';

describe('resolve', () => {
  it('applies an incoming record that does not exist locally', () => {
    expect(resolve('bean', at(EARLIER), null)).toEqual({ outcome: 'apply' });
  });

  it('applies a strictly newer incoming record', () => {
    expect(resolve('bean', at(LATER), at(EARLIER))).toEqual({ outcome: 'apply' });
  });

  it('rejects an older incoming record', () => {
    expect(resolve('bean', at(EARLIER), at(LATER))).toEqual({ outcome: 'stale' });
  });

  it('keeps the existing record on an exact tie, so re-pushing is a no-op', () => {
    expect(resolve('bean', at(LATER), at(LATER))).toEqual({ outcome: 'stale' });
  });

  // A delete arrives as a tombstone carrying its own clock, so it is resolved by
  // the same comparison as an edit. Both orderings are checked because the two
  // devices decide independently and neither knows which happened first.
  it('lets a newer delete beat an older edit', () => {
    const tombstone = at(LATER);
    expect(resolve('rating', tombstone, at(EARLIER, 2))).toEqual({ outcome: 'apply' });
  });

  it('lets a newer edit beat an older delete', () => {
    const edit = at(LATER, 2);
    expect(resolve('rating', edit, at(EARLIER, 2))).toEqual({ outcome: 'apply' });
  });

  it('halts when the incoming record was written by a newer build', () => {
    expect(resolve('bean', at(LATER, 99), at(EARLIER))).toEqual({
      outcome: 'needs-upgrade',
      incomingVersion: 99,
      supportedVersion: 1,
    });
  });

  it('halts on an unreadable record even when it is older than what we hold', () => {
    // The guard must run before the clock comparison: a newer schema is
    // unreadable regardless of when it was written.
    expect(resolve('bean', at(EARLIER, 99), at(LATER))).toMatchObject({
      outcome: 'needs-upgrade',
    });
  });

  it('accepts a record from an older build', () => {
    expect(resolve('rating', at(LATER, 1), at(EARLIER, 2))).toEqual({ outcome: 'apply' });
  });

  it('checks each type against its own supported version', () => {
    expect(SUPPORTED_SCHEMA_VERSIONS).toEqual({ bean: 1, rating: 2, photo: 1 });
    // schemaVersion 2 is current for ratings but ahead of beans.
    expect(resolve('rating', at(LATER, 2), null)).toEqual({ outcome: 'apply' });
    expect(resolve('bean', at(LATER, 2), null)).toMatchObject({ outcome: 'needs-upgrade' });
  });
});

describe('clockOf', () => {
  it('prefers updatedAt', () => {
    expect(clockOf({ createdAt: EARLIER, updatedAt: LATER })).toBe(LATER);
  });

  it('falls back to createdAt for immutable photo blobs', () => {
    expect(clockOf({ createdAt: EARLIER })).toBe(EARLIER);
  });
});
