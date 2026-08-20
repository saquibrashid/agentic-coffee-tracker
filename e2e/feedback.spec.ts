import { expect, test } from '@playwright/test';

/**
 * The privacy claims on this panel are the feature (#196): the repository is
 * public, so "we show you everything before it goes" has to be literally true
 * and has to keep being true.
 */
test.describe('Send feedback', () => {
  test('says it is public and lists what goes with it, before the button', async ({ page }) => {
    await page.goto('/settings');

    const attached = page.getByRole('group', { name: 'Sent with your message' });
    await expect(page.getByText('This becomes a public issue')).toBeVisible();
    await expect(page.getByText('Sent with your message')).toBeVisible();

    for (const label of ['App version', 'Screen', 'Display', 'Browser', 'Signed in', 'Sync']) {
      await expect(attached.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('not your name or email', { exact: false })).toBeVisible();
  });

  test('will not send an empty message', async ({ page }) => {
    await page.goto('/settings');
    const send = page.getByRole('button', { name: 'Send feedback' });
    await expect(send).toBeDisabled();

    await page.getByLabel('What happened?').fill('   ');
    await expect(send).toBeDisabled();

    await page.getByLabel('What happened?').fill('the label scan dropped the description');
    await expect(send).toBeEnabled();
  });

  test('keeps what you wrote when the send fails', async ({ page }) => {
    await page.route('**/api/feedback', (route) => route.abort());
    await page.goto('/settings');

    const message = page.getByLabel('What happened?');
    await message.fill('I got signed out again');
    await page.getByRole('button', { name: 'Send feedback' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(message).toHaveValue('I got signed out again');
  });

  test('links the issue it filed, so feedback is not sent into a void', async ({ page }) => {
    await page.route('**/api/feedback', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://github.com/o/r/issues/42', number: 42 }),
      }),
    );
    await page.goto('/settings');

    await page.getByLabel('What happened?').fill('the predict page confused me');
    await page.getByRole('button', { name: 'Send feedback' }).click();

    await expect(page.getByRole('link', { name: 'issue #42' })).toHaveAttribute(
      'href',
      'https://github.com/o/r/issues/42',
    );
    await expect(page.getByLabel('What happened?')).toHaveValue('');
  });

  test('points at the issue tracker when the deployment has no feedback wired up', async ({
    page,
  }) => {
    await page.route('**/api/feedback', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'nope', fallbackUrl: 'https://github.com/o/r/issues/new' }),
      }),
    );
    await page.goto('/settings');

    await page.getByLabel('What happened?').fill('something odd');
    await page.getByRole('button', { name: 'Send feedback' }).click();

    await expect(page.getByRole('link', { name: 'open an issue directly' })).toBeVisible();
    // Nothing was filed, so losing the text would lose the report entirely.
    await expect(page.getByLabel('What happened?')).toHaveValue('something odd');
  });
});
