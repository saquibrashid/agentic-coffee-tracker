import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Dark mode in a real browser (issue #110).
 *
 * The unit tests prove the rules and `contrast.test.ts` proves the token maths,
 * but neither can catch the failure this feature is most likely to have: the
 * class going on while the CSS variables do not actually change, because the
 * `.dark` selector never matched. These assert the *computed* colours.
 */

const routes = ['/', '/beans', '/settings'];

async function setPreference(page: Page, value: string) {
  await page.addInitScript((theme) => {
    window.localStorage.setItem('coffee-app.theme', theme);
  }, value);
}

test.describe('dark mode', () => {
  test('applies a deep brown background rather than near-black', async ({ page }) => {
    await setPreference(page, 'dark');
    await page.goto('/');

    const html = page.locator('html');
    await expect(html).toHaveClass(/dark/);

    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const [r, g, b] = background.match(/\d+/g)!.map(Number) as [number, number, number];

    // Brown means the channels are ordered and separated. Near-black or grey
    // would have r ≈ g ≈ b, which is exactly what the old palette produced.
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r - b).toBeGreaterThan(12);

    // Dark enough to be a dark theme, light enough for the hue to register.
    expect(r).toBeLessThan(90);
    expect(r).toBeGreaterThan(30);
  });

  test('light mode stays light', async ({ page }) => {
    await setPreference(page, 'light');
    await page.goto('/');

    await expect(page.locator('html')).not.toHaveClass(/dark/);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const [r] = background.match(/\d+/g)!.map(Number) as [number];
    expect(r).toBeGreaterThan(200);
  });

  test('honours the device setting when following the system', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await setPreference(page, 'system');
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await context.close();
  });

  // The whole reason the script is inline: a deferred module would paint light
  // first. If the class is present in the very first evaluation, it was applied
  // before the app module ever ran.
  test('is applied before the app module runs', async ({ page }) => {
    await setPreference(page, 'dark');
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('can be changed from Settings and survives a reload', async ({ page }) => {
    await page.goto('/settings');

    // Click the label, not the radio: the input is sr-only so that the control
    // keeps native keyboard semantics, which means the label is the thing a
    // real user (and Playwright's actionability checks) can actually hit.
    await page.locator('label:has(input[name="theme"][value="dark"])').click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  });

  // Keyboard users reach the group with Tab and move within it with arrows,
  // which only works because the inputs are real radios rather than buttons.
  test('is keyboard operable', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('radio', { name: 'System' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  for (const route of routes) {
    test(`a11y: ${route} has no critical violations in dark mode`, async ({ page }) => {
      await setPreference(page, 'dark');
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const critical = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      if (critical.length > 0) {
        console.log('Dark mode violations on', route, JSON.stringify(critical, null, 2));
      }
      expect(critical, 'critical/serious accessibility violations').toEqual([]);
    });
  }
});
