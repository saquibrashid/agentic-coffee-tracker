import { describe, expect, it } from 'vitest';

import {
  MICROSOFT_SIGN_OUT_URL,
  isSwitchAccountReturn,
  withSwitchAccountMarker,
  withoutSwitchAccountMarker,
} from './switchAccount';

describe('MICROSOFT_SIGN_OUT_URL', () => {
  // Entra ignores a post_logout_redirect_uri that is not registered on the app
  // registration, and the registration behind the pre-configured provider is
  // Microsoft's, not this deployment's. Adding one would promise a return that
  // never happens, and the UI copy is written around it not happening.
  it('carries no redirect back, because none would be honoured', () => {
    expect(MICROSOFT_SIGN_OUT_URL).not.toContain('post_logout_redirect_uri');
  });

  it('signs out against the common authority, since the account may be personal or work', () => {
    expect(MICROSOFT_SIGN_OUT_URL).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/logout',
    );
  });
});

describe('withSwitchAccountMarker', () => {
  it('adds the marker to a bare path', () => {
    expect(withSwitchAccountMarker('/settings')).toBe('/settings?switchAccount=1');
  });

  it('keeps the query already there, so the return lands where the user was', () => {
    expect(withSwitchAccountMarker('/settings?tab=account')).toBe(
      '/settings?tab=account&switchAccount=1',
    );
  });

  it('keeps the hash after the query rather than swallowing it', () => {
    expect(withSwitchAccountMarker('/settings?tab=account#sync')).toBe(
      '/settings?tab=account&switchAccount=1#sync',
    );
  });

  it('does not add the marker twice when a stale one is already present', () => {
    expect(withSwitchAccountMarker('/settings?switchAccount=1')).toBe('/settings?switchAccount=1');
  });
});

describe('isSwitchAccountReturn', () => {
  it('recognises the return leg', () => {
    expect(isSwitchAccountReturn('?switchAccount=1')).toBe(true);
  });

  it('ignores an ordinary page load', () => {
    expect(isSwitchAccountReturn('')).toBe(false);
    expect(isSwitchAccountReturn('?tab=account')).toBe(false);
  });

  // Only the value this app writes counts. A link someone was sent with
  // switchAccount=please should not push them into signing out of Microsoft.
  it('ignores any value other than the one this app sets', () => {
    expect(isSwitchAccountReturn('?switchAccount=0')).toBe(false);
    expect(isSwitchAccountReturn('?switchAccount=true')).toBe(false);
  });
});

describe('withoutSwitchAccountMarker', () => {
  it('removes the marker and the now-empty query string', () => {
    expect(withoutSwitchAccountMarker('/settings', '?switchAccount=1', '')).toBe('/settings');
  });

  it('leaves the rest of the query intact', () => {
    expect(withoutSwitchAccountMarker('/settings', '?tab=account&switchAccount=1', '')).toBe(
      '/settings?tab=account',
    );
  });

  it('preserves the hash', () => {
    expect(withoutSwitchAccountMarker('/settings', '?switchAccount=1', '#sync')).toBe(
      '/settings#sync',
    );
  });

  it('is a no-op on a URL that never had the marker', () => {
    expect(withoutSwitchAccountMarker('/coffees', '?sort=recent', '')).toBe('/coffees?sort=recent');
  });
});
