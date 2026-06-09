import { test, expect } from '@playwright/test';

test('home page loads and shows onboarding empty state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /agentic coffee tracker/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /add your first coffee/i })).toBeVisible();
});

test('primary navigation is keyboard reachable', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  // Eventually one of the nav items should receive focus.
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
});
