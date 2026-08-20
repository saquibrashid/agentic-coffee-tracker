import { test, expect, type Page } from '@playwright/test';

/**
 * Covers what the server tests cannot: that a grounded suggestion actually
 * reaches the user as a clickable coffee, with the roaster named and the
 * freshness claim dated — and that when nothing real could be verified, the
 * page says so instead of quietly looking the same (issue #179).
 *
 * `/api/recommend` is stubbed. The preview server has no model behind it, and
 * the point here is the rendering contract, not the search.
 */

const HEADER = 'roaster,coffee,score,brew,date,notes,roast,process,origin,tasting notes';

const CSV = [
  HEADER,
  ...Array.from(
    { length: 5 },
    (_, i) =>
      `Onyx Coffee Lab,Ethiopia Lot ${i + 1},10,latte,2025-03-0${i + 1},,light,washed,Ethiopia,"citrus; jasmine"`,
  ),
].join('\n');

const RATIONALE = 'Bright and citrus-forward, like the Ethiopians you rate highest.';

async function seedHistory(page: Page) {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Import' })).toBeVisible();
  await page.setInputFiles('#import-file', {
    name: 'history.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV, 'utf-8'),
  });
  await expect(page.getByText('5 ratings will be added')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Imported 5 ratings');
}

async function stubRecommend(page: Page, body: unknown) {
  await page.route('**/api/recommend', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

test.describe('For you — what to try next', () => {
  test('a grounded pick is a real coffee you can open', async ({ page }) => {
    await seedHistory(page);
    await stubRecommend(page, {
      grounded: true,
      model: 'test-model',
      recommendations: [
        {
          title: 'Holler Mountain',
          rationale: RATIONALE,
          basedOn: ['ethiopia', 'citrus'],
          origin: 'Ethiopia',
          roastLevel: 'light',
          process: 'washed',
          flavorNotes: ['citrus'],
          product: {
            roaster: 'Stumptown Coffee Roasters',
            name: 'Holler Mountain',
            url: 'https://stumptowncoffee.com/products/holler-mountain',
            verifiedAt: '2026-01-02T03:04:05.000Z',
          },
        },
      ],
    });

    await page.goto('/for-you');
    await page.getByRole('button', { name: /Suggest coffees|Refresh ideas/ }).click();

    await expect(page.getByRole('heading', { name: 'Holler Mountain' })).toBeVisible();
    await expect(page.getByText('Stumptown Coffee Roasters')).toBeVisible();

    const link = page.getByRole('link', { name: /View on stumptowncoffee\.com/ });
    await expect(link).toHaveAttribute(
      'href',
      'https://stumptowncoffee.com/products/holler-mountain',
    );
    // Opening a roaster's store must not hand it control of this tab.
    await expect(link).toHaveAttribute('rel', /noopener/);

    // Dates the claim rather than promising stock.
    await expect(page.getByText(/Listed when we checked/)).toBeVisible();
    await expect(page.getByText(/chosen only from pages a web search returned/)).toBeVisible();
  });

  test('says plainly when it could not verify a real coffee', async ({ page }) => {
    await seedHistory(page);
    await stubRecommend(page, {
      grounded: false,
      model: 'test-model',
      recommendations: [
        {
          title: 'Another Ethiopia washed',
          rationale: RATIONALE,
          basedOn: ['ethiopia'],
          origin: 'Ethiopia',
          roastLevel: 'light',
          process: 'washed',
          flavorNotes: ['citrus'],
        },
      ],
    });

    await page.goto('/for-you');
    await page.getByRole('button', { name: /Suggest coffees|Refresh ideas/ }).click();

    await expect(page.getByRole('heading', { name: 'Another Ethiopia washed' })).toBeVisible();
    await expect(page.getByText(/No real listings could be verified/)).toBeVisible();
    await expect(page.getByRole('link', { name: /View on/ })).toHaveCount(0);
  });
});
