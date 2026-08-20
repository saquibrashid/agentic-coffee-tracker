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

/**
 * The form lives on step 2 of the wizard, so every test that types into it has
 * to get there first. Typing the coffee out is a first-class route in, which is
 * lucky: it keeps these tests off the network.
 */
async function openDetails(page: Page) {
  await page.getByRole('button', { name: 'Skip and type the details' }).click();
  await expect(page.locator('#predict-origin')).toBeVisible();
}

async function fillCoffee(
  page: Page,
  values: { origin: string; process: string; roast: string; roaster?: string; name?: string },
) {
  await openDetails(page);
  await page.fill('#predict-origin', values.origin);
  await page.selectOption('#predict-process', values.process);
  await page.selectOption('#predict-roast', values.roast);
  if (values.roaster) await page.fill('#predict-roaster', values.roaster);
  if (values.name) await page.fill('#predict-name', values.name);
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

    await expect(page.getByTestId('prediction-baseline')).toContainText('above it');
  });

  test('names the coffee it is answering about', async ({ page }) => {
    // #197: checking several coffees from one roaster in a row produced a run
    // of identical-looking verdict cards with nothing to say which was which.
    await seedHistory(page);

    await page.goto('/predict');
    await fillCoffee(page, {
      origin: 'Ethiopia',
      process: 'natural',
      roast: 'light',
      roaster: 'Irving Farm',
      name: 'Konga',
    });
    await page.getByRole('button', { name: 'Will I like it?' }).click();

    await expect(page.getByTestId('prediction')).toContainText('Konga — Irving Farm');
  });

  test('falls back to the roaster when the coffee has no name', async ({ page }) => {
    await seedHistory(page);

    await page.goto('/predict');
    await fillCoffee(page, {
      origin: 'Ethiopia',
      process: 'natural',
      roast: 'light',
      roaster: 'Irving Farm',
    });
    await page.getByRole('button', { name: 'Will I like it?' }).click();

    const prediction = page.getByTestId('prediction');
    await expect(prediction).toContainText('Irving Farm');
    await expect(prediction).toContainText('This looks like your kind of coffee.');
  });

  test('a name alone is not enough to ask for a verdict', async ({ page }) => {
    // The name is a label, not evidence, so it must not enable the button.
    await seedHistory(page);

    await page.goto('/predict');
    await openDetails(page);
    await page.fill('#predict-name', 'Konga');

    await expect(page.getByRole('button', { name: 'Will I like it?' })).toBeDisabled();
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

    // The scale has to agree with the badge: a warning must not be drawn as a
    // score sitting above the user's usual.
    await expect(page.getByTestId('prediction-baseline')).toContainText('below it');
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

    // Going back to adjust something keeps the answer — the way back to it is
    // what says so — but an actual edit must throw it away, or it would be
    // describing a different coffee than the one in the form.
    await page.getByRole('button', { name: 'Adjust the details' }).click();
    await expect(page.getByRole('button', { name: 'Back to the verdict' })).toBeVisible();

    await page.fill('#predict-origin', 'Brazil');
    await expect(page.getByRole('button', { name: 'Back to the verdict' })).toHaveCount(0);
  });

  test('gives the verdict the screen to itself', async ({ page }) => {
    // #236: the answer used to render below the form, so on a phone it arrived
    // off-screen at the moment it appeared.
    await seedHistory(page);

    await page.goto('/predict');
    await fillCoffee(page, { origin: 'Ethiopia', process: 'natural', roast: 'light' });
    await page.getByRole('button', { name: 'Will I like it?' }).click();

    await expect(page.getByTestId('prediction')).toBeVisible();
    await expect(page.locator('#predict-origin')).toHaveCount(0);
    await expect(page.getByRole('meter', { name: 'Prediction confidence' })).toBeVisible();

    await page.getByRole('button', { name: 'Check another coffee' }).click();
    await expect(page.getByTestId('prediction')).toHaveCount(0);
    await expect(page.getByLabel(/photo of the bag/i)).toBeVisible();
  });
});
