import { describe, expect, it } from 'vitest';

import { normaliseEnrichUrl } from './url';

/**
 * Pasting the address is the escape hatch for coffees automatic lookup cannot
 * find, so it is tested as the last resort it is: forgiving of how people
 * actually copy links, and unwilling to spend a request on something that was
 * never a web page.
 */
describe('normaliseEnrichUrl', () => {
  it('accepts a product page pasted as-is', () => {
    expect(normaliseEnrichUrl('https://www.highwirecoffee.com/products/after-hours-decaf')).toBe(
      'https://www.highwirecoffee.com/products/after-hours-decaf',
    );
  });

  it('assumes https when the scheme was not copied', () => {
    expect(normaliseEnrichUrl('highwirecoffee.com/products/after-hours')).toBe(
      'https://highwirecoffee.com/products/after-hours',
    );
  });

  it('keeps tracking parameters rather than tidying the link', () => {
    // A store can key the exact product off a query parameter, so trimming what
    // looks like noise risks fetching a different coffee than the one chosen.
    const pasted =
      'https://www.stumptowncoffee.com/products/holler-mountain?variant=40006908969128';
    expect(normaliseEnrichUrl(pasted)).toBe(pasted);
  });

  it('tolerates surrounding whitespace from a copy', () => {
    expect(normaliseEnrichUrl('  https://example.com/x  ')).toBe('https://example.com/x');
  });

  it('rejects anything that is not a web page', () => {
    expect(normaliseEnrichUrl('')).toBeNull();
    expect(normaliseEnrichUrl('   ')).toBeNull();
    expect(normaliseEnrichUrl('not a url at all')).toBeNull();
    // A scheme that cannot be fetched, and a bare machine name.
    expect(normaliseEnrichUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseEnrichUrl('ftp://example.com/x')).toBeNull();
    expect(normaliseEnrichUrl('localhost/products/x')).toBeNull();
  });
});
