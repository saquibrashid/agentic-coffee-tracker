/**
 * Ending the Microsoft session, not just this app's.
 *
 * `/.auth/logout` clears the Static Web Apps cookie and nothing else. The
 * session at `login.microsoftonline.com` survives, so the next sign-in
 * completes silently against the same account and the user is never offered a
 * choice — someone who signed in with the wrong account is stuck with it.
 *
 * There is no way to fix this at sign-in with the pre-configured provider.
 * Measured against the live deployment: `prompt=select_account` is dropped
 * before the request reaches Entra — `/.auth/login/aad?prompt=select_account`
 * hands off to a shared identity host and arrives at `authorize` with no
 * `prompt` at all, under Microsoft's own multi-tenant client id rather than one
 * this deployment controls. Passing an external `post_logout_redirect_uri` is
 * dropped the same way, so the platform cannot hand sign-out to Microsoft for
 * us either.
 *
 * What is left is to send the browser to Entra's logout endpoint ourselves,
 * which takes two page loads: `/.auth/logout` has to run on this origin to drop
 * the app cookie, then Entra's endpoint has to run on Microsoft's. This module
 * is the marker that survives the trip between them.
 *
 * Deliberately not solved with a custom Entra app registration, which would
 * allow `prompt=select_account` on every sign-in. That means a client secret,
 * and `specs/sync.md` § Decisions already rejected a provider for exactly that
 * reason: a secret expiring on a timer is a recurring manual rotation that
 * fails closed silently, long after anyone remembers why.
 */

/**
 * Entra's v2 sign-out endpoint.
 *
 * `common` because the account being signed out may be personal or work, and
 * this deployment does not know which.
 *
 * No `post_logout_redirect_uri`: Entra only honours one that is registered on
 * the app registration, and the registration here belongs to Microsoft's shared
 * Static Web Apps client, not to us. An unregistered value is ignored, so
 * passing this app's URL would promise a return that never happens. The user
 * finishes on Microsoft's "you have signed out" page instead, which the UI says
 * up front rather than letting it be a surprise.
 */
export const MICROSOFT_SIGN_OUT_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/logout';

/**
 * Marks a sign-out as "and end the Microsoft session too", across the redirect
 * back from `/.auth/logout`.
 *
 * In the URL rather than in storage because the trip crosses a full page load
 * and, on iOS, the redirect can land in a different browsing context than the
 * one that started it.
 */
export const SWITCH_ACCOUNT_PARAM = 'switchAccount';

/** Adds the marker to a same-origin path, preserving anything already there. */
export function withSwitchAccountMarker(path: string): string {
  const [beforeHash, hash] = splitHash(path);
  const [pathname, query] = splitQuery(beforeHash);
  const params = new URLSearchParams(query);
  params.set(SWITCH_ACCOUNT_PARAM, '1');
  return `${pathname}?${params.toString()}${hash}`;
}

/** True when this page load is the return leg of a switch-account sign-out. */
export function isSwitchAccountReturn(search: string): boolean {
  return new URLSearchParams(search).get(SWITCH_ACCOUNT_PARAM) === '1';
}

/**
 * The same URL with the marker removed, so a reload or a shared link does not
 * put the user back into a sign-out they have already finished.
 */
export function withoutSwitchAccountMarker(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search);
  params.delete(SWITCH_ACCOUNT_PARAM);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}${hash}`;
}

function splitHash(value: string): [string, string] {
  const index = value.indexOf('#');
  return index === -1 ? [value, ''] : [value.slice(0, index), value.slice(index)];
}

function splitQuery(value: string): [string, string] {
  const index = value.indexOf('?');
  return index === -1 ? [value, ''] : [value.slice(0, index), value.slice(index + 1)];
}
