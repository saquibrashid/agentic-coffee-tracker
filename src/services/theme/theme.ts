/**
 * Theme preference: storage, resolution and application to the document.
 *
 * `specs/architecture.md` -> Dark mode. The palette has existed in
 * `globals.css` since the first commit, but nothing ever added the `.dark`
 * class, so it had never rendered for anyone. This module is what turns it on.
 *
 * ## Why localStorage rather than the `meta` IndexedDB store
 *
 * `architecture.md` says the preference lives in `meta`. It cannot, and the
 * reason is timing rather than taste: the theme has to be applied *before the
 * first paint*, or the app renders light and then flips, which is a worse
 * experience than having no dark mode at all. Reading IndexedDB is
 * asynchronous, so its value is never available at that moment.
 *
 * That makes a synchronous store mandatory, and `localStorage` is the only one.
 * Mirroring into `meta` as well would create a second copy that can disagree
 * with the one actually used at boot, so this is the single source of truth.
 * The deviation is recorded in `architecture.md`.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

/** The theme actually rendered, after `system` has been resolved. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'coffee-app.theme';

export const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * The colours the browser paints its own chrome with (address bar, task
 * switcher). These are the `--background` tokens resolved to hex; a browser
 * cannot read a CSS variable for `<meta name="theme-color">`.
 */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#faf7f2',
  dark: '#2b1f16',
};

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Anything unrecognised — a hand-edited value, a preference from a newer build,
 * a key collision — falls back to `system` rather than to a fixed theme, so a
 * corrupt value still tracks the device instead of pinning the wrong palette.
 */
export function normaliseThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : 'system';
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Storage access is wrapped because `localStorage` *throws* rather than
 * returning null in Safari private mode and when cookies are blocked. A theme
 * preference is never worth breaking the app over.
 *
 * `storage` accepts `null` as well as `undefined`, and the difference matters:
 * `undefined` means "not supplied, go and find it", because that is what a
 * default parameter does. Only `null` can say "there is no storage" — so it is
 * the only way to reach the branch below from a caller, and passing `undefined`
 * to test it silently tests the opposite.
 */
export function readStoredPreference(
  storage: Storage | null | undefined = safeStorage(),
): ThemePreference {
  if (!storage) return 'system';
  try {
    return normaliseThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function writeStoredPreference(
  preference: ThemePreference,
  storage: Storage | null | undefined = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Preference is not persisted; the current session still honours it.
  }
}

/** True when the device asks for a dark UI. Defaults to light where unknown. */
export function prefersDark(
  view: Pick<Window, 'matchMedia'> | undefined = globalThis.window,
): boolean {
  if (!view || typeof view.matchMedia !== 'function') return false;
  try {
    return view.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * Applies the resolved theme to the document.
 *
 * Also sets `color-scheme`, which is what makes browser-rendered UI the app
 * does not control — scrollbars, form controls, the spellcheck underline —
 * match. Without it a dark page keeps bright white scrollbars.
 */
export function applyTheme(
  theme: ResolvedTheme,
  doc: Document | undefined = globalThis.document,
): void {
  if (!doc?.documentElement) return;

  doc.documentElement.classList.toggle('dark', theme === 'dark');
  doc.documentElement.style.colorScheme = theme;

  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
}
