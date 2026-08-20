import { test, expect } from '@playwright/test';

test.describe('Settings danger zone', () => {
  test('delete button stays locked until the confirmation phrase is typed', async ({ page }) => {
    await page.goto('/settings');

    const deleteButton = page.getByRole('button', { name: 'Delete all data' });
    await expect(deleteButton).toBeDisabled();

    const input = page.getByLabel(/Type DELETE to confirm/i);
    // A near-miss must not unlock the control; this is the whole point of the gate.
    await input.fill('DELET');
    await expect(deleteButton).toBeDisabled();

    await input.fill('DELETE');
    await expect(deleteButton).toBeEnabled();

    // Clearing the field re-locks it, so an accidental keystroke cannot leave a
    // live destructive button sitting on screen.
    await input.fill('');
    await expect(deleteButton).toBeDisabled();
  });

  test('reports storage usage', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText(/Storage used/i)).toBeVisible();
    await expect(page.getByText(/available|does not report storage usage/i).first()).toBeVisible();
  });
});

test.describe('Sample coffees', () => {
  /**
   * The promise of the feature is not "rows appear in a table" — it is that the
   * three screens a new user cannot otherwise evaluate start saying something
   * (#241). So this walks the path a new user actually walks: load the samples,
   * then go and look at what they were loaded for.
   */
  test('turn the empty screens into working ones, and can be taken back out', async ({ page }) => {
    await page.goto('/settings');

    await page.getByRole('button', { name: 'Load sample coffees' }).click();
    await expect(page.getByRole('button', { name: 'Remove sample coffees' })).toBeVisible();

    await page.goto('/analytics');
    await expect(page.getByText(/Add your first coffee/i)).toHaveCount(0);

    // ...while being honest that the numbers on it are not the user's own.
    await expect(page.getByText(/These figures include \d+ sample coffees/i)).toBeVisible();

    // "Check" is the screen that most obviously fails without history: with none
    // it refuses to answer at all.
    await page.goto('/predict');
    await expect(page.getByText(/rate a few coffees|not enough/i)).toHaveCount(0);

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Remove sample coffees' }).click();
    await expect(page.getByRole('button', { name: 'Load sample coffees' })).toBeVisible();

    // Back to a genuinely empty library, not a half-cleared one.
    await page.goto('/analytics');
    await expect(page.getByText(/Add your first coffee/i).first()).toBeVisible();
  });
});
