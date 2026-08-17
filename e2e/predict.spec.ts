import { test, expect, type Page } from '@playwright/test';

/**
 * Drives the real "Will I like it?" flow end to end: seed a history through the
 * import screen, then check that a coffee matching the good half of that history
 * is recommended and one matching the bad half is not.
 *
 * The unit tests pin the arithmetic; this covers what they cannot — that the
 * form, the live query over Dexie and the verdict are actually wired together,
 * and that checking a coffee never writes one to the library.
 */

const HEADER = 'roaster,coffee,score,brew,date,notes,roast,process,origin,tasting notes';

/**
 * Ten ratings: five loved Ethiopian naturals, five disliked Brazilian washes.
 * Every row is fully described so the import queues no background lookups, which
 * would otherwise fire network calls the preview server cannot answer.
 */
const CSV = [
  HEADER,
  ...Array.from(
    { length: 5 },
    (_, i) =>
      `Onyx Coffee Lab,Ethiopia Lot ${i + 1},10,latte,2025-03-0${i + 1},,light,natural,Ethiopia,"blueberry; jasmine"`,
  ),
  ...Array.from(
    { length: 5 },
    (_, i) =>
      `Supermarket,Brazil Lot ${i + 1},2,latte,2025-04-0${i + 1},,dark,washed,Brazil,"rubber; ash"`,
  ),
].join('\n');

async function seedHistory(page: Page) {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Import' })).toBeVisible();
  await page.setInputFiles('#import-file', {
    name: 'history.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV, 'utf-8'),
  });
  await expect(page.getByText('10 ratings will be added')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Imported 10 ratings');
}

async function fillCoffee(
  page: Page,
  values: { origin: string; process: string; roast: string; roaster?: string },
) {
  await page.fill('#predict-origin', values.origin);
  await page.selectOption('#predict-process', values.process);
  await page.selectOption('#predict-roast', values.roast);
  if (values.roaster) await page.fill('#predict-roaster', values.roaster);
}

test.describe('will I like it?', () => {
  test('asks for some history before it will guess', async ({ page }) => {
    await page.goto('/predict');

    await expect(page.getByRole('heading', { name: 'Will I like it?' })).toBeVisible();
    await expect(page.getByText(/Log at least 3 ratings/)).toBeVisible();
    await expect(page.locator('#predict-origin')).toHaveCount(0);
  });

  test('recommends a coffee matching what the user already loves', async ({ page }) => {
    await seedHistory(page);

    await page.goto('/predict');
    await fillCoffee(page, { origin: 'Ethiopia', process: 'natural', roast: 'light' });
    await page.getByRole('button', { name: 'Will I like it?' }).click();

    const prediction = page.getByTestId('prediction');
    await expect(prediction).toContainText('This looks like your kind of coffee.');
    await expect(prediction).toContainText(
      'Coffees from Ethiopia average 10.0/10 across 5 ratings.',
    );

    const score = Number(await page.getByTestId('prediction-score').innerText());
    expect(score).toBeGreaterThan(8.4);
  });

  test('warns off a coffee matching what the user dislikes', async ({ page }) => {
    await seedHistory(page);

    await page.goto('/predict');
    await fillCoffee(page, { origin: 'Brazil', process: 'washed', roast: 'dark' });
    await page.getByRole('button', { name: 'Will I like it?' }).click();

    const prediction = page.getByTestId('prediction');
    await expect(prediction).toContainText('Probably not one for you.');
    await expect(prediction).toContainText('What gives us pause');

    const score = Number(await page.getByTestId('prediction-score').innerText());
    expect(score).toBeLessThan(6);
  });

  test('says so when it has nothing to go on, instead of guessing', async ({ page }) => {
    await seedHistory(page);

    await page.goto('/predict');
    await fillCoffee(page, { origin: 'Peru', process: '', roast: '' });
    await page.getByRole('button', { name: 'Will I like it?' }).click();

    const prediction = page.getByTestId('prediction');
    await expect(prediction).toContainText('Could go either way.');
    await expect(prediction).toContainText('Nothing rated yet for: Peru.');
  });

  test('never saves the coffee it was asked about', async ({ page }) => {
    await seedHistory(page);

    await page.goto('/predict');
    await fillCoffee(page, {
      origin: 'Ethiopia',
      process: 'natural',
      roast: 'light',
      roaster: 'Never Bought This',
    });
    await page.getByRole('button', { name: 'Will I like it?' }).click();
    await expect(page.getByTestId('prediction')).toBeVisible();

    await page.goto('/beans');
    await expect(page.getByText('Never Bought This')).toHaveCount(0);
  });

  test('clears the verdict as soon as the coffee is edited', async ({ page }) => {
    await seedHistory(page);

    await page.goto('/predict');
    await fillCoffee(page, { origin: 'Ethiopia', process: 'natural', roast: 'light' });
    await page.getByRole('button', { name: 'Will I like it?' }).click();
    await expect(page.getByTestId('prediction')).toBeVisible();

    // A verdict left on screen after the details change would describe a
    // different coffee than the one in the form.
    await page.fill('#predict-origin', 'Brazil');
    await expect(page.getByTestId('prediction')).toHaveCount(0);
  });
});
