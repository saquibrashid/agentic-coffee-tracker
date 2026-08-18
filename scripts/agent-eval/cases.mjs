/**
 * The input set both paths are measured on.
 *
 * Chosen to span the cases the pipeline treats differently rather than to be a
 * random sample, because the question in `specs/agentic-backend.md` §7 is
 * whether letting the model choose the order helps — and that can only show up
 * where the fixed order is a bad fit.
 *
 * - Most are Shopify stores, which the free store search resolves. Both paths
 *   should do well; the interesting number there is cost, not success.
 * - Blue Bottle is deliberately included because it is *not* Shopify. It is the
 *   documented blind spot of the free path, so it forces the paid fallback and
 *   is where the ladder's fixed order costs the most.
 * - A UK roaster checks that domain guessing is not quietly assuming `.com`.
 *
 * `expectedDomain` is the only hard ground truth asserted. Product names drift
 * as roasters retire coffees, and a case that has gone away is still a fair
 * comparison — both paths face the same missing product.
 */
export const CASES = [
  { roaster: 'Onyx Coffee Lab', name: 'Southern Weather', expectedDomain: 'onyxcoffeelab.com' },
  {
    roaster: 'Counter Culture Coffee',
    name: 'Hologram',
    expectedDomain: 'counterculturecoffee.com',
  },
  { roaster: 'Verve Coffee Roasters', name: 'Streetlevel', expectedDomain: 'vervecoffee.com' },
  { roaster: 'Heart Coffee Roasters', name: 'Stereo', expectedDomain: 'heartroasters.com' },
  {
    roaster: 'Intelligentsia Coffee',
    name: 'Black Cat Classic Espresso',
    expectedDomain: 'intelligentsia.com',
  },
  {
    roaster: 'Square Mile Coffee Roasters',
    name: 'Red Brick',
    expectedDomain: 'squaremilecoffee.com',
  },
  // Not on Shopify: the free path cannot see it however the domain is spelled.
  {
    roaster: 'Blue Bottle Coffee',
    name: 'Night Light Decaf',
    expectedDomain: 'bluebottlecoffee.com',
  },
];

/**
 * Fields worth having. Completeness rather than correctness: verifying every
 * value by hand across two paths and seven coffees would not survive the
 * roasters editing their own pages, and both paths are scored identically so
 * the comparison still holds.
 */
export function completeness(parsed) {
  if (!parsed) return 0;
  const filled = [
    Array.isArray(parsed.origins) && parsed.origins.length > 0,
    parsed.process !== null,
    parsed.roastLevel !== null,
    Array.isArray(parsed.tastingNotes) && parsed.tastingNotes.length > 0,
    typeof parsed.roasterDescription === 'string' && parsed.roasterDescription.length > 0,
    Array.isArray(parsed.varietals) && parsed.varietals.length > 0,
    parsed.elevationMeters !== null,
  ];
  return filled.filter(Boolean).length / filled.length;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True when the path ended up somewhere other than the roaster's own store. */
export function isWrongPage(sourceUrl, expectedDomain) {
  const host = hostOf(sourceUrl);
  if (!host) return true;
  return !(host === expectedDomain || host.endsWith(`.${expectedDomain}`));
}
