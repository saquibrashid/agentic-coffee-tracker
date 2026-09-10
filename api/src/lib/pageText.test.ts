import { describe, expect, it } from 'vitest';
import {
  MAX_PAGE_TEXT,
  MIN_USEFUL_TEXT,
  extractTextFromHtml,
  pageTextOmitsProduct,
  readPageText,
} from './pageText.js';

const URL = 'https://roaster.example/products/holler-mountain';

const DESCRIPTION =
  'Grown by the Nyeri cooperative at fifteen hundred metres and washed on the ' +
  'farm, this lot tastes of blackcurrant, cane sugar and dark chocolate.';

function jsonLd(product: Record<string, unknown>): string {
  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'http://schema.org/',
    '@type': 'Product',
    ...product,
  })}</script>`;
}

/** Menus, cart and footer: present on every storefront, about no coffee. */
const CHROME = `<nav>${'Shop All Coffee Gift Cards Subscribe Our Story Contact Us '.repeat(40)}</nav>`;

describe('readPageText', () => {
  it('keeps the page text when the page rendered its own description', () => {
    // The ordinary roaster page, and the reason this change is safe: nothing
    // about it should move, whatever its embedded block happens to contain.
    const html = `<html>${jsonLd({ name: 'Holler Mountain', description: DESCRIPTION })}
      <body>${CHROME}<p>${DESCRIPTION}</p></body></html>`;

    const page = readPageText(html, URL);

    expect(page.recoveredFromEmbedded).toBe(false);
    expect(page.text).toContain('blackcurrant');
  });

  it('uses the embedded block when a long page never mentions the coffee', () => {
    // Cometeer: 7,769 characters of navigation, cart, recipes and footer, and
    // not one word about the coffee it is selling.
    const html = `<html>${jsonLd({ name: 'Holler Mountain', description: DESCRIPTION })}
      <body>${CHROME}</body></html>`;

    const page = readPageText(html, URL);

    // The markup is long: length alone would have called this a good page.
    expect(extractTextFromHtml(html).length).toBeGreaterThan(MIN_USEFUL_TEXT);
    expect(page.recoveredFromEmbedded).toBe(true);
    expect(page.text).toContain('blackcurrant');
    expect(page.text).not.toContain('Gift Cards');
  });

  it('still rescues a page whose markup was empty', () => {
    // The original single-page-app case. It must keep working.
    const html = `<html>${jsonLd({ name: 'Holler Mountain', description: DESCRIPTION })}<body></body></html>`;

    const page = readPageText(html, URL);

    expect(page.recoveredFromEmbedded).toBe(true);
    expect(page.text).toContain('blackcurrant');
  });

  it('leaves a long page alone when there is no embedded block to consult', () => {
    // Onyx has no schema.org Product at all, so the text is the only source
    // there is — a page with nothing to compare against is not a page to doubt.
    const page = readPageText(`<html><body>${CHROME}</body></html>`, URL);

    expect(page.recoveredFromEmbedded).toBe(false);
    expect(page.text).toContain('Gift Cards');
  });

  it('does not hand back the box when a listing page embeds only a name', () => {
    // Cometeer's "build your own box" page embeds `Cometeer Coffee Bundle —
    // Default Variant` and no description. Recovering there would answer with
    // the box as though it were a coffee: confidently wrong, where leaving the
    // text alone is at most visibly wrong and is caught downstream (#291).
    const html = `<html>${jsonLd({ name: 'Cometeer Coffee Bundle — Default Variant' })}
      <body>${CHROME}</body></html>`;

    const page = readPageText(html, URL);

    expect(page.recoveredFromEmbedded).toBe(false);
    expect(page.text).not.toContain('Default Variant');
  });

  it('carries the roaster across when it recovers', () => {
    // schema.org puts the roaster in `brand`, and on a reseller's page that is
    // the only field naming them — the seller is the shop.
    const html = `<html>${jsonLd({
      name: 'Fast Forward — 8ct',
      description: DESCRIPTION,
      brand: { '@type': 'Thing', name: 'Counter Culture' },
    })}<body>${CHROME}</body></html>`;

    const page = readPageText(html, URL);

    expect(page.recoveredFromEmbedded).toBe(true);
    expect(page.text).toContain('Counter Culture');
    // `@type` is JSON-LD bookkeeping; "Thing" is not a roaster.
    expect(page.text).not.toContain('Thing');
  });

  it('caps recovered text the same way it caps page text', () => {
    const html = `<html>${jsonLd({ name: 'X', description: 'z'.repeat(MAX_PAGE_TEXT * 2) })}<body></body></html>`;

    expect(readPageText(html, URL).text.length).toBeLessThanOrEqual(MAX_PAGE_TEXT);
  });
});

describe('extractTextFromHtml', () => {
  /*
   * Storefront chrome is enormous and it comes first. On Counter Culture's
   * "Fast Forward" page it consumed 6,873 of the 8,000-character budget before
   * a single origin appeared, so the blend composition was cut off mid-list and
   * the model saw nine of eighteen lot fragments — chosen by where the
   * truncation happened to land rather than by relevance (#302).
   */
  const FILLER = 'tasting notes and brewing guidance for this lot. '.repeat(20);

  it('reads the content region in preference to the chrome around it', () => {
    const html = `<html><body>${CHROME}<main><p>${DESCRIPTION}</p><p>${FILLER}</p></main>${CHROME}</body></html>`;

    const text = extractTextFromHtml(html);

    expect(text).toContain('blackcurrant');
    expect(text).not.toContain('Gift Cards');
  });

  it('stops the chrome crowding out content the cap would otherwise cut', () => {
    const marker = 'fifty percent Manos Campesinas Guatemala';
    const bloat = `<nav>${'Shop Subscribe Gift Contact '.repeat(400)}</nav>`;
    const html = `<html><body>${bloat}<main><p>${DESCRIPTION}</p><p>${FILLER}</p><p>${marker}</p></main></body></html>`;

    expect(extractTextFromHtml(`<html><body>${bloat}<p>${marker}</p></body></html>`)).not.toContain(
      marker,
    );
    expect(extractTextFromHtml(html)).toContain(marker);
  });

  it('reads the whole document when the page has no content region', () => {
    // Every page that predates `<main>`, and plenty that postdate it.
    expect(extractTextFromHtml(`<html><body>${CHROME}</body></html>`)).toContain('Gift Cards');
  });

  it('falls back when the content region is too small to be the content', () => {
    // A decorative or malformed `<main>` must not throw away a page that had
    // its content elsewhere.
    const html = `<html><body><main> </main><p>${DESCRIPTION}</p><p>${FILLER}</p></body></html>`;

    expect(extractTextFromHtml(html)).toContain('blackcurrant');
  });

  it('reads to the last closing tag, not a stray one partway down', () => {
    // A stray `</main>` in a hand-written template is likelier than two genuine
    // content regions, and stopping at the first would truncate silently.
    const html = `<html><body><main><p>${FILLER}</p></main><p>${DESCRIPTION}</p></main></body></html>`;

    expect(extractTextFromHtml(html)).toContain('blackcurrant');
  });

  it('keeps the page title, which is where a storefront names its roaster', () => {
    // Reading the whole document picked this up for free; narrowing to `<main>`
    // dropped it, and Counter Culture's roaster went with it — the name is in
    // the title and the header and nowhere in the content region, so the first
    // narrowed lookup returned `roaster: null` where the old one had the name.
    const html = `<html><head><title>Fast Forward | Counter Culture Coffee</title></head><body>${CHROME}<main><p>${DESCRIPTION}</p><p>${FILLER}</p></main></body></html>`;

    const text = extractTextFromHtml(html);

    expect(text).toContain('Counter Culture Coffee');
    expect(text).toContain('blackcurrant');
    expect(text).not.toContain('Gift Cards');
  });

  it('does not repeat the title when it reads the whole document', () => {
    const html = `<html><head><title>Holler Mountain</title></head><body>${CHROME}</body></html>`;

    expect(extractTextFromHtml(html).match(/Holler Mountain/g)).toHaveLength(1);
  });

  it('still caps what it returns', () => {
    const html = `<html><body><main>${'z '.repeat(MAX_PAGE_TEXT)}</main></body></html>`;

    expect(extractTextFromHtml(html).length).toBeLessThanOrEqual(MAX_PAGE_TEXT);
  });
});

describe('pageTextOmitsProduct', () => {
  it('matches through the markup and punctuation a page adds', () => {
    // The same sentence split across elements, with an entity and a line break
    // in it, is still the same sentence.
    const rendered = extractTextFromHtml(
      '<p>Grown by the <em>Nyeri</em> cooperative at fifteen&nbsp;hundred metres</p>',
    );

    expect(pageTextOmitsProduct(rendered, `description: ${DESCRIPTION}`)).toBe(false);
  });

  it('says nothing when the description is too short to be distinctive', () => {
    // "A balanced blend" appears on half the internet, so failing to find it is
    // not evidence — and acting on it is the one way this can make a page worse.
    expect(pageTextOmitsProduct('an unrelated page', 'description: A balanced blend')).toBe(false);
  });

  it('ignores the name, which a page repeats in its title and breadcrumbs', () => {
    expect(pageTextOmitsProduct('an unrelated page', 'name: Some Coffee With A Long Name')).toBe(
      false,
    );
  });

  it('reads whichever field holds the prose, whatever the platform calls it', () => {
    // Storefronts spell it `descriptionHtml`, `details` or `subtitle`.
    expect(pageTextOmitsProduct('an unrelated page', `descriptionHtml: ${DESCRIPTION}`)).toBe(true);
    expect(pageTextOmitsProduct(DESCRIPTION, `details: ${DESCRIPTION}`)).toBe(false);
  });
});
