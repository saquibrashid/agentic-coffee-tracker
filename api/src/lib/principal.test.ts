import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HttpRequest } from '@azure/functions';

import { ALLOWED_PROVIDERS, UnauthenticatedError, requirePrincipal } from './principal.js';

/**
 * `specs/sync.md` -> Security constraint (blocking) requires a test that fails
 * if a sync route honours a forged principal header. This is that test: the
 * header is unsigned base64, so the *only* thing making it trustworthy is the
 * topology, and these cases pin that down.
 */

function request(headers: Record<string, string> = {}): HttpRequest {
  return { headers: new Headers(headers) } as unknown as HttpRequest;
}

function principalHeader(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

const VALID = principalHeader({ userId: 'user-a', identityProvider: 'aad' });

const original = process.env['SYNC_TRUSTED_PRINCIPAL_HEADER'];

afterEach(() => {
  if (original === undefined) delete process.env['SYNC_TRUSTED_PRINCIPAL_HEADER'];
  else process.env['SYNC_TRUSTED_PRINCIPAL_HEADER'] = original;
});

describe('in the trusted linked-backend topology', () => {
  beforeEach(() => {
    process.env['SYNC_TRUSTED_PRINCIPAL_HEADER'] = 'true';
  });

  it('resolves a well-formed principal', () => {
    expect(requirePrincipal(request({ 'x-ms-client-principal': VALID }))).toEqual({
      userId: 'user-a',
      provider: 'aad',
    });
  });

  it('rejects a request with no principal at all', () => {
    expect(() => requirePrincipal(request())).toThrow(UnauthenticatedError);
  });

  it('rejects a header that is not base64 JSON', () => {
    expect(() => requirePrincipal(request({ 'x-ms-client-principal': 'not-base64-json' }))).toThrow(
      UnauthenticatedError,
    );
  });

  it('rejects a principal with no subject', () => {
    // userId becomes the Cosmos partition key, so a blank one would collide
    // every such caller into a single shared dataset.
    expect(() =>
      requirePrincipal(
        request({ 'x-ms-client-principal': principalHeader({ identityProvider: 'aad' }) }),
      ),
    ).toThrow(UnauthenticatedError);
  });

  it('rejects an empty-string subject', () => {
    expect(() =>
      requirePrincipal(
        request({
          'x-ms-client-principal': principalHeader({ userId: '', identityProvider: 'aad' }),
        }),
      ),
    ).toThrow(UnauthenticatedError);
  });

  it('rejects a provider that is not configured', () => {
    // Every other provider is 404'd in staticwebapp.config.json. Reaching this
    // branch means that config failed, and an unreviewed identity source must
    // never be allowed to mint a partition key.
    expect(() =>
      requirePrincipal(
        request({
          'x-ms-client-principal': principalHeader({
            userId: 'user-a',
            identityProvider: 'github',
          }),
        }),
      ),
    ).toThrow(UnauthenticatedError);
  });

  it('configures Microsoft as the only provider', () => {
    expect([...ALLOWED_PROVIDERS]).toEqual(['aad']);
  });
});

describe('in an untrusted topology', () => {
  it('rejects even a perfectly-formed principal when the header cannot be trusted', () => {
    // The Free-tier topology has the browser calling the Function App directly,
    // where anyone can set this header and read any user's partition. Serving
    // sync at all there is the vulnerability, so the whole endpoint refuses.
    delete process.env['SYNC_TRUSTED_PRINCIPAL_HEADER'];

    expect(() => requirePrincipal(request({ 'x-ms-client-principal': VALID }))).toThrow(
      UnauthenticatedError,
    );
  });

  it('does not accept a truthy-looking value other than "true"', () => {
    process.env['SYNC_TRUSTED_PRINCIPAL_HEADER'] = '1';

    expect(() => requirePrincipal(request({ 'x-ms-client-principal': VALID }))).toThrow(
      UnauthenticatedError,
    );
  });
});
