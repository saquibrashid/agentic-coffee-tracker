import { test, expect } from '@playwright/test';

test('home page loads and shows onboarding empty state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /agentic coffee tracker/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /add your first coffee/i })).toBeVisible();
});

test('primary navigation is keyboard reachable', async ({ page, browserName }) => {
  // WebKit only tabs to form controls unless macOS "Full Keyboard Access" is on,
  // so pressing Tab never focuses a link there. That is a browser preference,
  // not an app defect — the a11y suite still asserts the markup is correct.
  test.skip(browserName === 'webkit', 'WebKit does not tab to links by default');

  await page.goto('/');
  await page.keyboard.press('Tab');
  // Eventually one of the nav items should receive focus.
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
});
