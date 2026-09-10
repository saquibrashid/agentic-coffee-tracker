import type { Page } from '@playwright/test';

/**
 * Opens one of the Settings page's collapsed sections.
 *
 * Every section on that page starts shut, so a test that goes straight for a
 * control inside one waits forever on something a real browser will not let it
 * touch. That is the intended behaviour, not a bug to work around: the page
 * held twelve sections and could not be taken in without scrolling all of it.
 *
 * Clicking the summary rather than setting `open` on the element keeps the test
 * honest — it is the same gesture the user makes, and it would still fail if
 * the row stopped being clickable.
 */
export async function openSettingsSection(page: Page, name: string | RegExp): Promise<void> {
  await page.locator('summary').filter({ hasText: name }).first().click();
}
