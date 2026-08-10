/**
 * React binding for the theme preference.
 *
 * Split from `theme.ts` so the resolution rules stay testable without a DOM,
 * and because `.ts` modules may export non-components freely (the Fast Refresh
 * lint rule forbids that from a `.tsx`).
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  applyTheme,
  prefersDark,
  readStoredPreference,
  resolveTheme,
  writeStoredPreference,
  type ResolvedTheme,
  type ThemePreference,
} from './theme';

const listeners = new Set<() => void>();

/**
 * The preference is module state rather than component state so every consumer
 * — the Settings control, and anything that later wants to show the current
 * theme — sees one value. Two `useState`s would drift the moment both rendered.
 */
let preference: ThemePreference = readStoredPreference();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThemePreference {
  return preference;
}

/** Server/prerender snapshot. No storage exists there, so `system` is the honest answer. */
function getServerSnapshot(): ThemePreference {
  return 'system';
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  writeStoredPreference(next);
  applyTheme(resolveTheme(next, prefersDark()));
  emit();
}

export interface ThemeState {
  preference: ThemePreference;
  /** What is actually on screen — `system` resolved against the device. */
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
}

export function useTheme(): ThemeState {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Re-applied on mount because the pre-paint script in index.html and this
  // module read the same key independently; if anything cleared the class in
  // between (a hot reload, a test harness), this is what puts it back.
  useEffect(() => {
    applyTheme(resolveTheme(current, prefersDark()));
  }, [current]);

  // While the preference is `system` the OS can change underneath us — at
  // sunset on a schedule, or from the control centre — and the app has to
  // follow without a reload. The listener is unconditional but the handler
  // checks the preference, so switching to an explicit theme stops it applying
  // without needing to tear the subscription down.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handle = (event: MediaQueryListEvent) => {
      if (preference !== 'system') return;
      applyTheme(resolveTheme('system', event.matches));
    };

    query.addEventListener('change', handle);
    return () => query.removeEventListener('change', handle);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => setThemePreference(next), []);

  return {
    preference: current,
    resolved: resolveTheme(current, prefersDark()),
    setPreference,
  };
}
