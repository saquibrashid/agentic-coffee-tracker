import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const routes = ['/', '/add', '/beans', '/for-you', '/analytics', '/summary', '/settings'];

for (const route of routes) {
  test(`a11y: ${route} has no critical violations`, async ({ page }) => {
    await page.goto(route);
    // Wait for page to settle
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    if (critical.length > 0) {
      console.log('Accessibility violations on', route, JSON.stringify(critical, null, 2));
    }
    expect(critical, 'critical/serious accessibility violations').toEqual([]);
  });
}
