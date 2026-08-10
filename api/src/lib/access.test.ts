import { describe, expect, it } from 'vitest';

import {
  ForbiddenError,
  isAllowed,
  parseAllowlist,
  readAccessPolicy,
  requireAccess,
  type AccessPolicy,
} from './access.js';
import type { Principal } from './principal.js';

const OWNER: Principal = {
  userId: 'abc123',
  provider: 'aad',
  userDetails: 'owner@example.com',
};

const STRANGER: Principal = {
  userId: 'zzz999',
  provider: 'aad',
  userDetails: 'someone@else.com',
};

function policy(mode: AccessPolicy['mode'], entries: string[] = []): AccessPolicy {
  return { mode, allowed: new Set(entries) };
}

describe('parseAllowlist', () => {
  it('accepts a comma-separated list', () => {
    expect([...parseAllowlist('a,b,c')]).toEqual(['a', 'b', 'c']);
  });

  it('accepts semicolons, spaces and newlines', () => {
    // The value gets pasted out of a portal blade, a Bicep parameter or a shell
    // export, and each of those mangles separators differently.
    expect([...parseAllowlist('a; b\nc\td')]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lower-cases entries so sign-in names match regardless of casing', () => {
    expect([...parseAllowlist('Owner@Example.COM')]).toEqual(['owner@example.com']);
  });

  it('discards empty entries from a trailing or doubled separator', () => {
    expect([...parseAllowlist('a,,b,')]).toEqual(['a', 'b']);
  });

  it('treats missing configuration as an empty list', () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist('').size).toBe(0);
    expect(parseAllowlist('   ').size).toBe(0);
  });
});

describe('readAccessPolicy', () => {
  it('defaults to membership when nothing is configured', () => {
    // The default must never be 'open': an absent parameter would then publish
    // the deployment to anyone with a Microsoft account.
    expect(readAccessPolicy({}).mode).toBe('allowlist');
  });

  it('falls back to membership for an unrecognised mode', () => {
    expect(readAccessPolicy({ SYNC_ACCESS_MODE: 'pubic' }).mode).toBe('allowlist');
  });

  it('reads the modes it does recognise, ignoring casing and padding', () => {
    expect(readAccessPolicy({ SYNC_ACCESS_MODE: ' Open ' }).mode).toBe('open');
    expect(readAccessPolicy({ SYNC_ACCESS_MODE: 'OWNER' }).mode).toBe('owner');
  });

  it('reads the allowlist', () => {
    const parsed = readAccessPolicy({ SYNC_ALLOWLIST: 'abc123, owner@example.com' });
    expect(parsed.allowed.has('abc123')).toBe(true);
    expect(parsed.allowed.has('owner@example.com')).toBe(true);
  });
});

describe('isAllowed', () => {
  it('admits an account listed by user id', () => {
    expect(isAllowed(OWNER, policy('owner', ['abc123']))).toBe(true);
  });

  it('admits an account listed by sign-in name', () => {
    // The only value an operator can know before the first sign-in, which is
    // what makes bootstrapping possible at all.
    expect(isAllowed(OWNER, policy('owner', ['owner@example.com']))).toBe(true);
  });

  it('matches a sign-in name irrespective of casing', () => {
    const shouty: Principal = { ...OWNER, userDetails: 'Owner@Example.com' };
    expect(isAllowed(shouty, policy('allowlist', ['owner@example.com']))).toBe(true);
  });

  it('rejects an account that is not listed', () => {
    expect(isAllowed(STRANGER, policy('owner', ['abc123']))).toBe(false);
  });

  it('rejects everyone when the list is empty', () => {
    // Fail closed. Treating "unconfigured" as "allow all" would silently open
    // the deployment the moment a parameter went missing.
    expect(isAllowed(OWNER, policy('owner'))).toBe(false);
    expect(isAllowed(OWNER, policy('allowlist'))).toBe(false);
  });

  it('admits everyone in open mode, even with an empty list', () => {
    expect(isAllowed(STRANGER, policy('open'))).toBe(true);
  });

  it('supports several approved accounts', () => {
    expect(isAllowed(STRANGER, policy('allowlist', ['abc123', 'zzz999']))).toBe(true);
  });

  it('does not admit a principal with no sign-in name on a name-only list', () => {
    const anonymous: Principal = { userId: 'nnn', provider: 'aad' };
    expect(isAllowed(anonymous, policy('allowlist', ['owner@example.com']))).toBe(false);
  });

  it('does not treat an empty sign-in name as a match for an empty entry', () => {
    // parseAllowlist drops empty entries, so this can only happen if the set is
    // constructed directly — but a blank match would admit every account.
    const blank: Principal = { userId: 'nnn', provider: 'aad', userDetails: '   ' };
    expect(isAllowed(blank, { mode: 'allowlist', allowed: new Set(['']) })).toBe(false);
  });

  it('rejects an unknown mode rather than defaulting to permit', () => {
    expect(isAllowed(OWNER, { mode: 'nonsense' as AccessPolicy['mode'], allowed: new Set() })).toBe(
      false,
    );
  });
});

describe('requireAccess', () => {
  it('permits an approved account', () => {
    expect(() => requireAccess(OWNER, { SYNC_ALLOWLIST: 'abc123' })).not.toThrow();
  });

  it('rejects an unapproved account', () => {
    expect(() => requireAccess(STRANGER, { SYNC_ALLOWLIST: 'abc123' })).toThrow(ForbiddenError);
  });

  it('names the caller id so the fix is a copy and paste', () => {
    // The caller is a real signed-in user; a bare 403 turns a two-minute
    // configuration fix into a debugging session.
    expect(() => requireAccess(STRANGER, { SYNC_ALLOWLIST: 'abc123' })).toThrow(/zzz999/);
  });

  it('does not disclose who is approved', () => {
    try {
      requireAccess(STRANGER, { SYNC_ALLOWLIST: 'abc123,secret@example.com' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain('secret@example.com');
      expect((err as Error).message).not.toContain('abc123');
    }
  });

  it('rejects everyone when the deployment is unconfigured', () => {
    expect(() => requireAccess(OWNER, {})).toThrow(ForbiddenError);
  });

  it('permits anyone once the deployment is opened up', () => {
    expect(() => requireAccess(STRANGER, { SYNC_ACCESS_MODE: 'open' })).not.toThrow();
  });
});
