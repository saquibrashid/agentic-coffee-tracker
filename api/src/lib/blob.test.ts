import { describe, expect, it } from 'vitest';
import { PHOTO_QUOTA_BYTES, fitsQuota, isSafeId, photoBlobName } from './blob.js';

/**
 * Only the pure helpers are covered here. Everything else in `blob.ts` needs a
 * real storage account to say anything true — `specs/sync.md` -> Testing puts
 * that behind an integration environment that does not exist yet, so the logic
 * that can be wrong on its own was extracted to be testable on its own.
 */

describe('isSafeId', () => {
  it('accepts the id shapes actually in use', () => {
    expect(isSafeId('3f6b2c0e-9a1d-4c8b-8f2e-1b7d5a9c0e11')).toBe(true);
    expect(isSafeId('sid:1a2b3c')).toBe(false);
    expect(isSafeId('user_123.photo-1')).toBe(true);
  });

  it('rejects anything that could escape the user prefix', () => {
    expect(isSafeId('..')).toBe(false);
    expect(isSafeId('../other-user')).toBe(false);
    expect(isSafeId('a/b')).toBe(false);
    expect(isSafeId('a\\b')).toBe(false);
  });

  it('rejects empty and oversized ids', () => {
    expect(isSafeId('')).toBe(false);
    expect(isSafeId('a'.repeat(128))).toBe(true);
    expect(isSafeId('a'.repeat(129))).toBe(false);
  });
});

describe('photoBlobName', () => {
  it('namespaces every blob under its owner', () => {
    expect(photoBlobName('user-1', 'photo-1')).toBe('user-1/photo-1');
  });

  it('throws rather than emitting a traversing path', () => {
    // The failure mode this guards is one user reading or overwriting another
    // user's photo, so it must be loud rather than sanitised into something
    // plausible-looking.
    expect(() => photoBlobName('user-1', '../user-2/photo-1')).toThrow(/unsafe/i);
    expect(() => photoBlobName('../admin', 'photo-1')).toThrow(/unsafe/i);
  });
});

describe('fitsQuota', () => {
  it('allows an upload that exactly fills the quota', () => {
    expect(fitsQuota(0, 100, 100)).toBe(true);
    expect(fitsQuota(40, 60, 100)).toBe(true);
  });

  it('refuses one byte past the quota', () => {
    expect(fitsQuota(40, 61, 100)).toBe(false);
  });

  it('refuses an upload when already at the limit', () => {
    expect(fitsQuota(100, 1, 100)).toBe(false);
  });

  it('refuses sizes that are not real byte counts', () => {
    // A negative or non-finite size would otherwise pass the arithmetic and
    // hand out a SAS for an upload of unknown length.
    expect(fitsQuota(0, -1, 100)).toBe(false);
    expect(fitsQuota(0, Number.NaN, 100)).toBe(false);
    expect(fitsQuota(0, Number.POSITIVE_INFINITY, 100)).toBe(false);
  });

  it('defaults to the specified 500 MB budget', () => {
    expect(PHOTO_QUOTA_BYTES).toBe(500 * 1024 * 1024);
    expect(fitsQuota(PHOTO_QUOTA_BYTES, 1)).toBe(false);
    expect(fitsQuota(PHOTO_QUOTA_BYTES - 1, 1)).toBe(true);
  });
});
