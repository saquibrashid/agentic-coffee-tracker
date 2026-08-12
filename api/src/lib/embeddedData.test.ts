import { describe, expect, it } from 'vitest';

import {
  extractEmbeddedProduct,
  findProductNode,
  productFromJsonLd,
  productNodeToImageUrl,
  productNodeToText,
  slugFromUrl,
} from './embeddedData.js';

/**
 * The shape a browser-rendered storefront actually serves, reduced to what
 * matters here. Modelled on Blue Bottle's page, which is the one that enriched
 * to blank: the product sits behind a routing wrapper that claims the same
 * slug, and the coffees it recommends live in the same blob — ahead of the
 * coffee that was asked for.
 */
function nextDataPage(): string {
  const payload = {
    props: {
      pageProps: {
        // Claims the slug and knows nothing about coffee.
        region: 'us',
        lang: 'eng',
        slug: 'night-light-decaf',
        crossSellProducts: [
          {
            slug: { current: 'hayes-valley-espresso' },
            name: { eng: 'Hayes Valley Espresso' },
            roastLevel: [{ label: { eng: 'Dark Roast' } }],
            flavorProfile: { eng: 'Baking chocolate, orange zest, brown sugar' },
          },
        ],
        conversion: {
          _type: 'product',
          _rev: 'abc123',
          slug: { current: 'night-light-decaf' },
          name: { _type: 'localizedString', eng: 'Night Light Decaf' },
          roastLevel: [{ _key: 'm6gy', label: { eng: 'Medium Roast' }, roastLevel: 2 }],
          flavorProfile: { _type: 'localizedString', eng: 'Crème Brûlée, Vanilla, Key Lime' },
          processing: null,
          descriptionV2: [
            {
              _key: 'o21i',
              description: {
                eng: [{ children: [{ text: 'As one of our darker coffees, endlessly malty.' }] }],
              },
            },
          ],
          images: [
            {
              desktop: {
                source: {
                  url: 'http://res.cloudinary.com/x/night-light.png',
                  secure_url: 'https://res.cloudinary.com/x/night-light.png',
                },
              },
            },
          ],
        },
      },
    },
  };
  return `<html><head></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`;
}

const PRODUCT_URL = 'https://bluebottlecoffee.com/us/eng/product/night-light-decaf';

describe('slugFromUrl', () => {
  it('reads the product slug from the paths storefronts use', () => {
    expect(slugFromUrl(PRODUCT_URL)).toBe('night-light-decaf');
    expect(slugFromUrl('https://stumptowncoffee.com/products/holler-mountain')).toBe(
      'holler-mountain',
    );
  });

  it('ignores a query string and a trailing slash', () => {
    expect(slugFromUrl('https://x.com/products/holler-mountain?variant=4000')).toBe(
      'holler-mountain',
    );
    expect(slugFromUrl('https://x.com/products/holler-mountain/')).toBe('holler-mountain');
  });

  it('has nothing to go on for a bare domain', () => {
    expect(slugFromUrl('https://bluebottlecoffee.com/')).toBeNull();
    expect(slugFromUrl('not a url')).toBeNull();
  });
});

describe('findProductNode', () => {
  it('skips the routing wrapper that shares the slug', () => {
    const data = JSON.parse(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(nextDataPage())![1]!,
    ) as unknown;

    const product = findProductNode(data, 'night-light-decaf');
    expect(product).not.toBeNull();
    // The wrapper carries `region`; the product carries the coffee.
    expect(product?.['name']).toEqual({ _type: 'localizedString', eng: 'Night Light Decaf' });
  });

  it('returns nothing when the only match describes nothing', () => {
    const data = { pageProps: { slug: 'night-light-decaf', region: 'us', lang: 'eng' } };
    expect(findProductNode(data, 'night-light-decaf')).toBeNull();
  });

  it('accepts the Shopify spelling of a slug', () => {
    const data = {
      product: { handle: 'holler-mountain', title: 'Holler Mountain', notes: 'Cocoa' },
    };
    expect(findProductNode(data, 'holler-mountain')).not.toBeNull();
  });
});

describe('productNodeToText', () => {
  it('reads through the wrappers a content platform adds', () => {
    const text = productNodeToText({
      name: { _type: 'localizedString', eng: 'Night Light Decaf' },
      descriptionV2: [{ description: { eng: [{ children: [{ text: 'Endlessly malty.' }] }] } }],
    });
    expect(text).toContain('Night Light Decaf');
    expect(text).toContain('Endlessly malty.');
  });

  it('leaves out the platform bookkeeping', () => {
    const text = productNodeToText({
      name: 'Night Light Decaf',
      _rev: 'Z2ifNddhPzbllS5vYaMIgP',
      _type: 'product',
    });
    expect(text).not.toContain('Z2ifNddhPzbllS5vYaMIgP');
    expect(text).not.toContain('product');
  });

  it('says nothing at all about fields that are not the coffee', () => {
    expect(productNodeToText({ cartCopy: 'Your cart is empty', region: 'us' })).toBe('');
  });

  it('tells a growing region from a storefront locale', () => {
    // "region" names both, and `region: us` would invite the parser to record
    // the coffee as grown in the United States.
    expect(productNodeToText({ region: 'us', country: 'us' })).toBe('');
    expect(productNodeToText({ region: 'Yirgacheffe' })).toBe('region: Yirgacheffe');
  });

  it('does not repeat a value the page states twice', () => {
    const text = productNodeToText({ name: ['Night Light', 'Night Light', 'night light'] });
    expect(text).toBe('name: Night Light');
  });
});

describe('productNodeToImageUrl', () => {
  it('prefers the https form a CDN offers alongside http', () => {
    const url = productNodeToImageUrl({
      images: [
        { desktop: { source: { url: 'http://cdn/x.png', secure_url: 'https://cdn/x.png' } } },
      ],
    });
    expect(url).toBe('https://cdn/x.png');
  });

  it('has no answer when the product carries no image', () => {
    expect(productNodeToImageUrl({ name: 'Night Light Decaf' })).toBeUndefined();
  });
});

describe('productFromJsonLd', () => {
  it('finds a product inside a graph', () => {
    const product = productFromJsonLd({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'BreadcrumbList' }, { '@type': 'Product', name: 'Holler Mountain' }],
    });
    expect(product?.['name']).toBe('Holler Mountain');
  });

  it('copes with a type given as a list', () => {
    expect(productFromJsonLd({ '@type': ['Thing', 'Product'], name: 'X' })).not.toBeNull();
  });

  it('is not fooled by a page describing only its organisation', () => {
    expect(productFromJsonLd({ '@type': 'Organization', name: 'Blue Bottle' })).toBeNull();
  });
});

describe('extractEmbeddedProduct', () => {
  it('recovers the coffee from a page that renders in the browser', () => {
    const result = extractEmbeddedProduct(nextDataPage(), PRODUCT_URL);

    expect(result).not.toBeNull();
    expect(result?.text).toContain('Night Light Decaf');
    expect(result?.text).toContain('Medium Roast');
    expect(result?.text).toContain('Crème Brûlée, Vanilla, Key Lime');
    expect(result?.text).toContain('darker coffees');
    expect(result?.imageUrl).toBe('https://res.cloudinary.com/x/night-light.png');
  });

  it('does not enrich a coffee with the details of the one beside it', () => {
    // The page recommends Hayes Valley, and those recommendations sit ahead of
    // the product in the payload. Applying them would silently rewrite this
    // coffee as a different one.
    const result = extractEmbeddedProduct(nextDataPage(), PRODUCT_URL);

    expect(result?.text).not.toContain('Hayes Valley');
    expect(result?.text).not.toContain('Dark Roast');
    expect(result?.text).not.toContain('orange zest');
  });

  it('prefers schema.org markup when the page publishes it', () => {
    const html = `<html><script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name: 'Holler Mountain',
      description: 'Citrus, hazelnut, and caramel.',
    })}</script></html>`;

    const result = extractEmbeddedProduct(html, 'https://x.com/products/holler-mountain');
    expect(result?.text).toContain('Holler Mountain');
    expect(result?.text).toContain('Citrus, hazelnut, and caramel.');
  });

  it('steps over a JSON block that will not parse', () => {
    const html = `<html><script type="application/json">{not json</script><script type="application/ld+json">${JSON.stringify(
      { '@type': 'Product', name: 'Holler Mountain' },
    )}</script></html>`;

    expect(extractEmbeddedProduct(html, 'https://x.com/products/holler-mountain')?.text).toContain(
      'Holler Mountain',
    );
  });

  it('reports nothing rather than guessing', () => {
    expect(extractEmbeddedProduct('<html><body>Hello</body></html>', PRODUCT_URL)).toBeNull();
    // A page whose data is about something else entirely.
    const unrelated = `<html><script type="application/json">${JSON.stringify({
      cart: { heading: 'Your Cart' },
    })}</script></html>`;
    expect(extractEmbeddedProduct(unrelated, PRODUCT_URL)).toBeNull();
  });
});
