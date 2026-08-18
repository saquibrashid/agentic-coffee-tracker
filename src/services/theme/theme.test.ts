import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The pre-paint script lives in index.html, so the assertions that it still
// agrees with this module need the file's text. Imported as a raw string for
// the same reason as contrast.test.ts — no node types in the client tsconfig.
import indexHtml from '../../../index.html?raw';

import {
  THEME_COLORS,
  THEME_STORAGE_KEY,
  applyTheme,
  normaliseThemePreference,
  prefersDark,
  readStoredPreference,
  resolveTheme,
  writeStoredPreference,
} from './theme';

/** A `localStorage` stand-in that can be made to throw, as Safari private mode does. */
function makeStorage(initial: Record<string, string> = {}, throws = false): Storage {
  const map = new Map(Object.entries(initial));
  const guard = () => {
    if (throws) throw new DOMException('QuotaExceededError');
  };
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => {
      guard();
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      guard();
      map.set(k, v);
    },
    removeItem: (k: string) => {
      guard();
      map.delete(k);
    },
  };
}

describe('normaliseThemePreference', () => {
  it.each(['system', 'light', 'dark'])('passes through %s', (value) => {
    expect(normaliseThemePreference(value)).toBe(value);
  });

  // A corrupt value must track the device rather than pin a palette: guessing
  // "light" would leave a dark-mode user staring at a white screen with a
  // control that claims to be set to something else.
  it.each([null, undefined, '', 'Dark', 'blue', 42, {}])('falls back to system for %s', (value) => {
    expect(normaliseThemePreference(value)).toBe('system');
  });
});

describe('readStoredPreference', () => {
  it('reads a stored value', () => {
    expect(readStoredPreference(makeStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
  });

  it('returns system when nothing is stored', () => {
    expect(readStoredPreference(makeStorage())).toBe('system');
  });

  it('returns system when storage is unavailable', () => {
    // `null`, not `undefined`: a default parameter is applied precisely when
    // the argument is `undefined`, so passing that would read real
    // `localStorage` and assert nothing about this branch.
    expect(readStoredPreference(null)).toBe('system');
  });

  it('survives storage that throws', () => {
    expect(readStoredPreference(makeStorage({}, true))).toBe('system');
  });
});

describe('writeStoredPreference', () => {
  it('persists the value', () => {
    const storage = makeStorage();
    writeStoredPreference('light', storage);
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  // Losing the preference is acceptable; throwing out of a click handler and
  // leaving the settings page in a broken state is not.
  it('does not throw when storage refuses the write', () => {
    expect(() => writeStoredPreference('dark', makeStorage({}, true))).not.toThrow();
  });

  it('does not throw when storage is unavailable', () => {
    // See `readStoredPreference` above for why this is `null` and not
    // `undefined`. This one would have passed either way, but only by writing
    // a stray key into the real `localStorage` that other test files then read.
    expect(() => writeStoredPreference('dark', null)).not.toThrow();
  });
});

describe('resolveTheme', () => {
  it('honours an explicit preference over the device', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the device when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('prefersDark', () => {
  it('reports the media query result', () => {
    const view = { matchMedia: vi.fn().mockReturnValue({ matches: true }) };
    expect(prefersDark(view as unknown as Window)).toBe(true);
    expect(view.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
  });

  it('defaults to light where matchMedia is missing or throws', () => {
    expect(prefersDark(undefined)).toBe(false);
    expect(prefersDark({} as unknown as Window)).toBe(false);
    const throwing = {
      matchMedia: () => {
        throw new Error('unsupported');
      },
    };
    expect(prefersDark(throwing as unknown as Window)).toBe(false);
  });
});

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
    document.head.innerHTML = '<meta name="theme-color" content="#000000" />';
  });

  afterEach(() => {
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
  });

  it('adds the dark class and matching chrome colour', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      THEME_COLORS.dark,
    );
  });

  it('removes the dark class when switching back to light', () => {
    applyTheme('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      THEME_COLORS.light,
    );
  });

  // color-scheme is what makes scrollbars and native form controls dark; a
  // dark page with a bright white scrollbar is the giveaway that it is missing.
  it('sets color-scheme so browser-drawn UI matches', () => {
    applyTheme('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('tolerates a page with no theme-color meta tag', () => {
    document.head.innerHTML = '';
    expect(() => applyTheme('dark')).not.toThrow();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does nothing without a document', () => {
    expect(() => applyTheme('dark', undefined)).not.toThrow();
  });
});

/**
 * index.html carries a copy of this logic so the theme lands before the first
 * paint — an imported module would run too late. These assert the copy still
 * agrees with the module, which is the only thing keeping the duplication safe.
 */
describe('pre-paint script in index.html', () => {
  const html = indexHtml;

  it('reads the same storage key', () => {
    expect(html).toContain(THEME_STORAGE_KEY);
  });

  it('uses the same chrome colours', () => {
    expect(html).toContain(THEME_COLORS.dark);
    expect(html).toContain(THEME_COLORS.light);
  });

  it('runs before the app module so there is no flash of the wrong theme', () => {
    const script = html.indexOf(THEME_STORAGE_KEY);
    const appModule = html.indexOf('/src/main.tsx');
    expect(script).toBeGreaterThan(-1);
    expect(appModule).toBeGreaterThan(script);
  });

  it('is inline rather than a deferred module', () => {
    expect(html).toMatch(/<script>\s*\(function \(\)/);
  });
});
