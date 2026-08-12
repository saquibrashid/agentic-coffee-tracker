/**
 * Which navigations the service worker must not answer itself.
 *
 * The app is a single-page app, so the service worker answers navigations with
 * the cached `index.html` and lets the router take it from there. That is right
 * for every route the app owns and wrong for every path the *platform* owns,
 * because those are not app routes at all — they are endpoints Azure Static Web
 * Apps serves itself, and handing back the app shell means the browser never
 * reaches them.
 *
 * `/.auth/*` is the one that bites. Signing in is a full-page navigation to
 * `/.auth/login/aad`, which the platform answers with a redirect to Microsoft.
 * With the service worker installed and that path missing from this list, the
 * navigation is served the app shell instead: the URL bar says
 * `/.auth/login/aad`, the router has no such route, and the user is shown a 404
 * from an app that is working perfectly. Sign-out fails the same way, which is
 * worse — someone who cannot sign out has no way to hand the device over.
 *
 * The rule to apply when adding to this list: if the path is not something
 * React Router can render, the service worker has no business answering it.
 */
export const NAVIGATION_FALLBACK_DENYLIST: RegExp[] = [
  // The BFF. Serving these the app shell turns an API failure into a confusing
  // HTML response.
  /^\/api/,
  // Platform authentication: /.auth/login/<provider>, /.auth/logout, /.auth/me.
  /^\/\.auth/,
];
