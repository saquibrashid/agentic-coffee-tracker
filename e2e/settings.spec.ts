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
