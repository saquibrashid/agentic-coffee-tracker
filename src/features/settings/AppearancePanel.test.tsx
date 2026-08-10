import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppearancePanel } from './AppearancePanel';
import { THEME_COLORS, THEME_STORAGE_KEY } from '@/services/theme/theme';
import { setThemePreference } from '@/services/theme/useTheme';

/**
 * The unit tests in theme.test.ts prove the rules; this proves the wiring —
 * that choosing an option in Settings actually reaches `<html>`. That join is
 * where a dark mode most plausibly fails: every piece can be correct while
 * nothing ever adds the class, which is precisely the bug issue #110 reports.
 */
describe('AppearancePanel', () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '<meta name="theme-color" content="#000000" />';
    // The preference is module state shared by every consumer, so it has to be
    // put back or tests leak into one another through it.
    setThemePreference('system');
  });

  it('offers system, light and dark', () => {
    render(<AppearancePanel />);
    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument();
  });

  it('applies the dark class and persists the choice', async () => {
    const user = userEvent.setup();
    render(<AppearancePanel />);

    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      THEME_COLORS.dark,
    );
  });

  it('returns to light without a reload', async () => {
    const user = userEvent.setup();
    render(<AppearancePanel />);

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    await user.click(screen.getByRole('radio', { name: 'Light' }));

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  // The reason the control is three-way: an explicit choice must be reversible
  // back to following the device.
  it('can go back to following the device after an override', async () => {
    const user = userEvent.setup();
    render(<AppearancePanel />);

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    await user.click(screen.getByRole('radio', { name: 'System' }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
  });

  it('describes what the current setting means', async () => {
    const user = userEvent.setup();
    render(<AppearancePanel />);

    expect(screen.getByText(/following your device/i)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByText(/always dark/i)).toBeInTheDocument();
  });
});
