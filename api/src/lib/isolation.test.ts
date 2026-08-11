import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest, InvocationContext } from '@azure/functions';

import { resolveSyncCaller } from './syncAuth.js';
import { resetRateLimitsForTests, SYNC_RATE_LIMIT } from './rateLimit.js';
import { photoBlobName, isSafeId } from './blob.js';

/**
 * `specs/sync.md` -> Testing, "Security" row: a forged `x-ms-client-principal`
 * is rejected, and user A cannot reach user B's records or blobs.
 *
 * `principal.test.ts` already covers forgery of the header itself. What this
 * file pins down is the property that matters once a caller *is* legitimately
 * authenticated: every identifier the server uses to address storage is derived
 * from the principal, and nothing a client can put in a request body can move
 * it. That is the only reason a shared Cosmos container and a shared blob
 * container are safe to use at all.
 */

const TRUSTED = 'SYNC_TRUSTED_PRINCIPAL_HEADER';

function ctx(): InvocationContext {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as InvocationContext;
}

function request(principal: unknown): HttpRequest {
  return {
    headers: new Headers(
      principal === undefined
        ? {}
        : {
            'x-ms-client-principal': Buffer.from(JSON.stringify(principal), 'utf8').toString(
              'base64',
            ),
          },
    ),
  } as unknown as HttpRequest;
}

function signedInAs(userId: string, userDetails?: string): HttpRequest {
  return request({ userId, identityProvider: 'aad', userDetails });
}

const saved = {
  trusted: process.env[TRUSTED],
  mode: process.env['SYNC_ACCESS_MODE'],
  list: process.env['SYNC_ALLOWLIST'],
};

beforeEach(() => {
  resetRateLimitsForTests();
  process.env[TRUSTED] = 'true';
  process.env['SYNC_ACCESS_MODE'] = 'open';
  delete process.env['SYNC_ALLOWLIST'];
});

afterEach(() => {
  for (const [key, value] of [
    [TRUSTED, saved.trusted],
    ['SYNC_ACCESS_MODE', saved.mode],
    ['SYNC_ALLOWLIST', saved.list],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('resolveSyncCaller', () => {
  it('returns the principal for an approved, authenticated caller', () => {
    const result = resolveSyncCaller(signedInAs('user-a'), ctx());

    expect(result.ok).toBe(true);
    expect(result.ok && result.principal.userId).toBe('user-a');
  });

  it('401s an unauthenticated caller', () => {
    const result = resolveSyncCaller(request(undefined), ctx());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.response.status).toBe(401);
  });

  it('401s a principal from a provider this deployment does not configure', () => {
    const result = resolveSyncCaller(
      request({ userId: 'user-a', identityProvider: 'github' }),
      ctx(),
    );
    expect(!result.ok && result.response.status).toBe(401);
  });

  it('401s every caller when the topology cannot vouch for the header', () => {
    // The direct-call topology, where the header is attacker-supplied. Being
    // authenticated in the eyes of the header is worth nothing here.
    delete process.env[TRUSTED];

    const result = resolveSyncCaller(signedInAs('user-a'), ctx());
    expect(!result.ok && result.response.status).toBe(401);
  });

  it('403s an authenticated caller who is not on the allowlist', () => {
    process.env['SYNC_ACCESS_MODE'] = 'allowlist';
    process.env['SYNC_ALLOWLIST'] = 'user-b';

    const result = resolveSyncCaller(signedInAs('user-a'), ctx());
    expect(!result.ok && result.response.status).toBe(403);
  });

  it('429s once the caller exhausts their budget', () => {
    for (let i = 0; i < SYNC_RATE_LIMIT.capacity; i++) {
      expect(resolveSyncCaller(signedInAs('user-a'), ctx()).ok).toBe(true);
    }

    const result = resolveSyncCaller(signedInAs('user-a'), ctx());
    expect(!result.ok && result.response.status).toBe(429);
    expect(!result.ok && result.response.headers).toHaveProperty('retry-after');
  });

  it('does not let an unauthenticated caller drain somebody else\u2019s budget', () => {
    // The bucket is keyed by userId, so charging it before the identity is
    // established would let an anonymous flood lock out the account it names.
    delete process.env[TRUSTED];
    for (let i = 0; i < SYNC_RATE_LIMIT.capacity * 2; i++) {
      resolveSyncCaller(signedInAs('user-a'), ctx());
    }

    process.env[TRUSTED] = 'true';
    expect(resolveSyncCaller(signedInAs('user-a'), ctx()).ok).toBe(true);
  });

  it('does not let a rejected account drain an approved one\u2019s budget', () => {
    process.env['SYNC_ACCESS_MODE'] = 'allowlist';
    process.env['SYNC_ALLOWLIST'] = 'user-a';

    for (let i = 0; i < SYNC_RATE_LIMIT.capacity * 2; i++) {
      resolveSyncCaller(signedInAs('user-b'), ctx());
    }
    expect(resolveSyncCaller(signedInAs('user-a'), ctx()).ok).toBe(true);
  });

  it('rate-limits each user independently', () => {
    for (let i = 0; i < SYNC_RATE_LIMIT.capacity; i++)
      resolveSyncCaller(signedInAs('user-a'), ctx());

    expect(resolveSyncCaller(signedInAs('user-b'), ctx()).ok).toBe(true);
  });
});

describe('cross-user isolation', () => {
  it('derives the partition key from the principal, never from the body', () => {
    // Every sync handler reads userId off the resolved principal. There is no
    // code path that takes it from the request, and this asserts the shape that
    // makes that true: resolveSyncCaller never sees the body at all.
    const a = resolveSyncCaller(signedInAs('user-a'), ctx());
    const b = resolveSyncCaller(signedInAs('user-b'), ctx());

    expect(a.ok && a.principal.userId).toBe('user-a');
    expect(b.ok && b.principal.userId).toBe('user-b');
  });

  it('ignores a userId smuggled in userDetails', () => {
    // userDetails is used for allowlist matching and logging only; it must
    // never become the partition key, because it is re-assignable.
    const result = resolveSyncCaller(signedInAs('user-a', 'user-b@example.com'), ctx());

    expect(result.ok && result.principal.userId).toBe('user-a');
  });

  it('confines a photo blob to the caller\u2019s own prefix', () => {
    expect(photoBlobName('user-a', 'photo-1')).toBe('user-a/photo-1');
  });

  it.each([
    ['a parent traversal', '..'],
    ['a nested traversal', '../user-b/photo-1'],
    ['an absolute path', '/user-b/photo-1'],
    ['a bare separator', 'user-b/photo-1'],
    ['a backslash', 'user-b\\photo-1'],
    ['a current-directory segment', '.'],
    ['an encoded traversal', '%2e%2e%2fuser-b'],
    ['a null byte', 'photo-1\u0000'],
    ['an empty id', ''],
  ])('refuses to build a blob path from %s', (_label, photoId) => {
    // Photo ids are client-generated, so this is the one place a caller has
    // direct influence over a storage path. Anything that could escape the
    // user's prefix is rejected outright rather than escaped.
    expect(isSafeId(photoId)).toBe(false);
    expect(() => photoBlobName('user-a', photoId)).toThrow();
  });

  it('refuses a hostile userId just as firmly as a hostile photoId', () => {
    // Belt and braces: userId comes from the provider and should never look
    // like this, but the prefix is what the quota and the delete loop scope to.
    expect(() => photoBlobName('../user-b', 'photo-1')).toThrow();
  });

  it('keeps two users\u2019 blob prefixes disjoint', () => {
    const a = photoBlobName('user-a', 'shared-id');
    const b = photoBlobName('user-b', 'shared-id');

    // Same photo id, different users: the paths must not collide, and neither
    // may be a prefix of the other, or a prefix-scoped list would see both.
    expect(a).not.toBe(b);
    expect(a.startsWith(`${b}/`)).toBe(false);
    expect(b.startsWith(`${a}/`)).toBe(false);
  });
});
