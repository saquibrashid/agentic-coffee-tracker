import { describe, expect, it } from 'vitest';

import { NAVIGATION_FALLBACK_DENYLIST } from './serviceWorker';

/**
 * These guard a failure that is invisible in development and total in
 * production: with no service worker registered, signing in works; with one
 * registered and a path missing from the denylist, the same click shows a 404
 * from the router while the platform endpoint is never reached.
 */

function isDenied(path: string): boolean {
  return NAVIGATION_FALLBACK_DENYLIST.some((pattern) => pattern.test(path));
}

describe('navigation fallback denylist', () => {
  it.each([
    ['/.auth/login/aad', 'starting sign-in'],
    ['/.auth/logout', 'signing out'],
    ['/.auth/me', 'reading the session'],
    ['/api/sync/pull', 'the sync endpoint'],
    ['/api/parse', 'the parse endpoint'],
  ])('leaves %s to the platform (%s)', (path) => {
    expect(isDenied(path)).toBe(true);
  });

  it('still lets the app answer its own routes', () => {
    // The denylist must stay narrow: anything caught here stops working
    // offline, which is the whole point of the app.
    for (const path of ['/', '/beans', '/beans/01HZ', '/add', '/analytics', '/settings']) {
      expect(isDenied(path)).toBe(false);
    }
  });

  it('does not catch app routes that merely mention a platform path', () => {
    // Anchored patterns, so a bean whose id or query happens to contain
    // ".auth" or "api" is still an app route.
    expect(isDenied('/beans/rapid')).toBe(false);
    expect(isDenied('/settings?return=/.auth/me')).toBe(false);
  });
});
