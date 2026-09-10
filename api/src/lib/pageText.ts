/**
 * Turning a fetched product page into the text a model can read.
 *
 * This lived inside `scrape.ts` while the HTTP endpoint was the only caller.
 * The agent loop in `agent.ts` needs exactly the same treatment — the same
 * stripping, the same cap, the same fallback to embedded JSON for pages that
 * render in the browser — and two implementations that were supposed to agree
 * would drift the moment either was tuned. Fixing that is what this file is
 * for; the behaviour is unchanged.
 */

import { extractEmbeddedProduct } from './embeddedData.js';

/**
 * Enough of a page to describe a coffee, and not so much that a single fetch
 * dominates the context window. The agent budget makes that second point
 * sharper than it was for the endpoint: several pages may be read in one
 * request.
 */
export const MAX_PAGE_TEXT = 8000;

/**
 * Below this, a page has not told us anything about a coffee.
 *
 * A storefront that renders on the server runs to thousands of characters; one
 * that renders in the browser leaves a shell whose only text is a noscript
 * warning, if that. The gap between the two is wide enough that the exact
 * figure does not matter — it only has to sit clear of both.
 *
 * It is not, however, the whole test. See `pageTextOmitsProduct`.
 */
export const MIN_USEFUL_TEXT = 400;

/**
 * The part of a page that is about the product, when the page says which part
 * that is.
 *
 * Storefront chrome is enormous and it is *first*: on Counter Culture's "Fast
 * Forward" page the menus, cart and search consume 6,873 of the 8,000-character
 * budget before a single origin appears, and the blend composition is then cut
 * off mid-list — the model was shown nine of eighteen lot fragments, chosen by
 * where the truncation happened to land (#302).
 *
 * `<main>` is the page's own answer to "which part of this is the content", so
 * it is used when present rather than guessed at. Stripping `nav`, `header` and
 * `footer` instead was tried and barely helped: this storefront, like most,
 * builds its chrome from `div`s.
 *
 * Greedy to the *last* `</main>`, not the first. A stray closing tag partway
 * down is far more common in hand-written templates than two genuine main
 * regions, and stopping early would silently truncate the content.
 */
const MAIN_CONTENT = /<main\b[^>]*>([\s\S]*)<\/main>/i;

/**
 * The page's own title, which on a storefront names the roaster.
 *
 * Reading the whole document picked this up for free. Narrowing to `<main>`
 * dropped it, and the roaster went with it: Counter Culture's page says
 * "Counter Culture Coffee" in its title and its header and nowhere inside the
 * content region, so the first narrowed lookup came back with `roaster: null`
 * where the old one had the name. Keeping the title is what makes the narrowing
 * a strict improvement rather than a trade.
 */
const TITLE = /<title\b[^>]*>([\s\S]*?)<\/title>/i;

function stripToText(html: string): string {
  // Naive: strip scripts/styles then tags. For production use a proper parser.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTextFromHtml(html: string): string {
  const whole = stripToText(html);

  const match = MAIN_CONTENT.exec(html);
  if (match?.[1] === undefined) return whole.slice(0, MAX_PAGE_TEXT);

  // A `<main>` that yields almost nothing is a malformed or decorative one, and
  // trusting it would throw away a page that had the content elsewhere. The
  // whole document is the safer answer whenever the narrowing did not pay off.
  const main = stripToText(match[1]);
  if (main.length < MIN_USEFUL_TEXT) return whole.slice(0, MAX_PAGE_TEXT);

  const title = stripToText(TITLE.exec(html)?.[1] ?? '');
  return (title ? `${title} ${main}` : main).slice(0, MAX_PAGE_TEXT);
}

/** Strips markup, entities and punctuation so two renderings compare equal. */
function comparable(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Enough words to be this page's description and nobody else's.
 *
 * Matching the whole description would fail on any page that breaks it across
 * elements or reflows the whitespace, and matching a handful of words would
 * collide with boilerplate. An opening clause is specific without being brittle.
 */
const PROBE_WORDS = 8;

/**
 * Short descriptions carry no signal in either direction. "A balanced blend"
 * appears verbatim on half the internet, so failing to find it says nothing
 * about whether the page rendered its product, and acting on that would be the
 * one way this check can make a working page worse.
 */
const MIN_PROBE_CHARS = 24;

/**
 * Fields that identify the product rather than describe it.
 *
 * These are excluded from the comparison, and that exclusion is load-bearing.
 * A page's name for itself appears in its title bar, its breadcrumbs and its
 * heading, so finding it proves nothing about whether the product rendered —
 * and *not* finding it proves less still. Cometeer's box-builder page embeds
 * `name: "Cometeer Coffee Bundle — Default Variant"` and renders "Cometeer
 * Coffee Bundle" without the platform's variant suffix; comparing on that
 * would conclude the page had rendered nothing and hand back the bundle as
 * though it were a coffee. That is the confident wrong answer this whole file
 * is trying to avoid, arrived at from the opposite direction.
 *
 * The question is only ever whether the page rendered its *prose*.
 */
const IDENTITY_FIELDS = new Set(['name', 'title', 'subtitle', 'heading', 'label']);

/**
 * True when the page's own description of the product is nowhere in its text.
 *
 * Length was the original test for "did we get anything", and it is not enough.
 * Cometeer returns 7,769 characters for a coffee it renders entirely in the
 * browser: navigation, cart, sustainability copy, recipes and a footer, and not
 * one word about the coffee. That clears `MIN_USEFUL_TEXT` more than seventeen
 * times over while containing exactly as much product detail as an empty page.
 *
 * The embedded block is the page's own statement of what it is selling. If the
 * page then failed to render that statement as text, the text we scraped is not
 * about the product — which is evidence rather than a threshold, and it is why
 * this asks about the description instead of asking how long the page is.
 *
 * The comparison uses the longest embedded value rather than a field called
 * `description`, because storefront platforms spell it `descriptionHtml`,
 * `subtitle` or `details`, and whichever one holds the prose is the longest.
 */
export function pageTextOmitsProduct(pageText: string, embeddedText: string): boolean {
  const values = embeddedText
    .split('\n')
    .filter((line) => {
      const key = line.slice(0, line.indexOf(':')).trim().toLowerCase();
      return !IDENTITY_FIELDS.has(key);
    })
    .map((line) => comparable(line.replace(/^[^:]+:\s*/, '')))
    .sort((a, b) => b.length - a.length);

  const longest = values[0];
  if (longest === undefined) return false;

  const probe = longest.split(' ').slice(0, PROBE_WORDS).join(' ');
  if (probe.length < MIN_PROBE_CHARS) return false;

  return !comparable(pageText).includes(probe);
}

export interface PageText {
  text: string;
  /** Set only when the text came from an embedded JSON block. */
  imageUrl?: string;
  /** True when the embedded block supplied the text the markup did not. */
  recoveredFromEmbedded: boolean;
}

/**
 * Reads a page's product text, falling back to its embedded data.
 *
 * There are two ways the markup can fail to describe the product, and both end
 * here. It can arrive empty, which is the single-page-app case this was written
 * for. Or it can arrive long and be about everything except the coffee, which
 * is what a client-rendered storefront does: chrome renders on the server and
 * the product does not. The second was invisible while the only test was length.
 *
 * A page whose text does describe its product is untouched, which is every
 * ordinary roaster page and the reason this is safe. The embedded block is
 * consulted, not preferred: on a listing page it names the box rather than any
 * coffee, and trusting it there would turn a visibly wrong answer into a
 * confident one.
 */
export function readPageText(html: string, finalUrl: string): PageText {
  const text = extractTextFromHtml(html);
  const embedded = extractEmbeddedProduct(html, finalUrl);
  if (!embedded) return { text, recoveredFromEmbedded: false };

  const markupEmpty = text.length < MIN_USEFUL_TEXT;
  if (!markupEmpty && !pageTextOmitsProduct(text, embedded.text)) {
    return { text, recoveredFromEmbedded: false };
  }

  return {
    text: embedded.text.slice(0, MAX_PAGE_TEXT),
    ...(embedded.imageUrl ? { imageUrl: embedded.imageUrl } : {}),
    recoveredFromEmbedded: true,
  };
}
