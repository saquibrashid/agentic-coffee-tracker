/**
 * The context that makes a feedback report actionable, and nothing else.
 *
 * Kept apart from the component so the rule can be *tested* rather than
 * reviewed: this is the only place the app decides what leaves the device
 * alongside someone's words, and the repository that receives it is public
 * (#196).
 *
 * Two things are deliberately absent. **Identity** — not the user id, which is
 * the Cosmos partition key, and not the email; "signed in: yes" is the part
 * that explains a sync report and who is not. **Content** — no coffee names, no
 * ratings, no photos. If someone wants to name a coffee they can type it; the
 * app must not do it on their behalf, because they cannot un-publish it.
 */

import { getSyncStatus } from '@/services/sync/status';

export const APP_VERSION = '0.1.0';

export interface FeedbackDiagnostics {
  appVersion: string;
  route: string;
  display: string;
  userAgent: string;
  signedIn: boolean;
  syncState: string;
}

/**
 * A short, human phrase rather than the raw UA string.
 *
 * The full string is a wall of version numbers that nobody previewing this
 * screen can read, and "show the user everything being sent" only means
 * something if what is shown is legible. The parts that have ever mattered for
 * a bug here are the engine and the platform.
 */
export function describeBrowser(userAgent: string): string {
  const engine = /\bFirefox\//.test(userAgent)
    ? 'Firefox'
    : /\bEdg\//.test(userAgent)
      ? 'Edge'
      : /\bChrome\//.test(userAgent)
        ? 'Chrome'
        : /\bSafari\//.test(userAgent)
          ? 'Safari'
          : 'Unknown browser';

  const platform = /\biPhone|\biPad/.test(userAgent)
    ? 'iOS'
    : /\bAndroid/.test(userAgent)
      ? 'Android'
      : /\bMac OS X/.test(userAgent)
        ? 'macOS'
        : /\bWindows/.test(userAgent)
          ? 'Windows'
          : /\bLinux/.test(userAgent)
            ? 'Linux'
            : 'unknown platform';

  return `${engine} on ${platform}`;
}

/**
 * Installed-to-home-screen, or a browser tab.
 *
 * Worth a line because some reports only make sense in one of the two — a
 * standalone PWA has no address bar to fall back on and its own service-worker
 * lifecycle.
 */
export function describeDisplay(standalone: boolean): string {
  return standalone ? 'Installed to home screen' : 'Browser tab';
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const navigatorStandalone = (navigator as { standalone?: boolean }).standalone;
  return (
    navigatorStandalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  );
}

export function collectDiagnostics(route: string): FeedbackDiagnostics {
  const sync = getSyncStatus();
  return {
    appVersion: APP_VERSION,
    route,
    display: describeDisplay(isStandalone()),
    userAgent: describeBrowser(typeof navigator === 'undefined' ? '' : navigator.userAgent),
    // 'disabled' is the state a signed-out device sits in, which is the one bit
    // of account context worth publishing.
    signedIn: sync.state !== 'disabled',
    syncState: sync.state,
  };
}

/** The same diagnostics as label/value pairs, for the preview above the button. */
export function diagnosticRows(diagnostics: FeedbackDiagnostics): [string, string][] {
  return [
    ['App version', diagnostics.appVersion],
    ['Screen', diagnostics.route],
    ['Display', diagnostics.display],
    ['Browser', diagnostics.userAgent],
    ['Signed in', diagnostics.signedIn ? 'yes' : 'no'],
    ['Sync', diagnostics.syncState],
  ];
}
