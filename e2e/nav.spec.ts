import { test, expect } from '@playwright/test';

/**
 * The primary nav packs six items into a single row. At phone widths the labels
 * used to collide -- "Analytics" and "Summary" ran together at 390px, back when
 * a seventh item was there to collide with.
 *
 * The meaningful assertion is that each label is *fully readable*, not merely
 * that the boxes do not overlap: `truncate` alone stops labels overlapping by
 * clipping them, which still leaves the nav unreadable.
 *
 * Note `scrollWidth` is NOT a reliable clipping signal here -- once
 * `text-overflow: ellipsis` kicks in the browser clamps it to `clientWidth`,
 * so a truncated label looks like a fitting one. We instead measure the real
 * laid-out text via a Range and compare it against the *content box* (i.e.
 * clientWidth minus horizontal padding), which is the space the text actually
 * gets.
 */

const PHONE_WIDTHS = [360, 390, 430];

const NAV_LABELS = ['Home', 'Add', 'Coffees', 'Check', 'For you', 'Analytics'];

test.describe('primary navigation', () => {
  for (const width of PHONE_WIDTHS) {
    test(`labels are fully readable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);

      const labels = page.locator('nav[aria-label="Primary"] a > span:last-child');
      await expect(labels).toHaveCount(NAV_LABELS.length);

      const measured = await labels.evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          const cs = getComputedStyle(n);
          const range = document.createRange();
          range.selectNodeContents(n);
          return {
            text: n.textContent ?? '',
            left: r.left,
            right: r.right,
            textWidth: range.getBoundingClientRect().width,
            contentWidth: n.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
          };
        }),
      );

      for (const label of measured) {
        expect(
          label.textWidth,
          `"${label.text}" is clipped (text needs ${label.textWidth.toFixed(1)}px, content box is ${label.contentWidth.toFixed(1)}px)`,
        ).toBeLessThanOrEqual(label.contentWidth);
      }

      for (let i = 1; i < measured.length; i++) {
        const prev = measured[i - 1]!;
        const cur = measured[i]!;
        expect(
          cur.left,
          `"${prev.text}" (ends ${prev.right}) overlaps "${cur.text}" (starts ${cur.left})`,
        ).toBeGreaterThanOrEqual(prev.right);
      }
    });
  }

  test('does not scroll horizontally at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto('/');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('every destination keeps its accessible name', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const nav = page.locator('nav[aria-label="Primary"]');
    for (const name of NAV_LABELS) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
  });

  /**
   * Settings gave up its slot to the library (#247), so it has to be reachable
   * from every screen some other way or the swap has simply lost a destination.
   */
  test('settings is still one tap away from anywhere', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/analytics');

    await page.getByRole('link', { name: 'Settings', exact: true }).click();

    await expect(page).toHaveURL(/\/settings$/);
  });

  test('the library is reachable without going via Home', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/analytics');

    await page
      .locator('nav[aria-label="Primary"]')
      .getByRole('link', { name: 'Coffees', exact: true })
      .click();

    await expect(page).toHaveURL(/\/beans$/);
  });

  /**
   * The nav has to sit at the bottom of the screen whether the page under it is
   * long or short, or it jumps around as you move between screens.
   *
   * `position: sticky` alone does not do this. It pins an element only while its
   * container is taller than the viewport; on a short page the container ends
   * early and the nav simply sits wherever the content stopped — halfway up the
   * screen on an empty Analytics, at the bottom on Home. So the interesting case
   * is a *short* page, and asserting on Home would pass without the layout being
   * right at all.
   */
  for (const [name, path] of [
    ['a short page', '/analytics'],
    ['a long page', '/'],
  ] as const) {
    test(`stays at the bottom of the screen on ${name}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);

      const nav = page.locator('nav[aria-label="Primary"]');
      await expect(nav).toBeVisible();

      const gap = await nav.evaluate(
        (el) => window.innerHeight - el.getBoundingClientRect().bottom,
      );
      expect(gap, `nav bottom is ${gap}px above the bottom of the viewport`).toBeLessThanOrEqual(1);
    });
  }
});
