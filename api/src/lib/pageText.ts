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
 */
export const MIN_USEFUL_TEXT = 400;

export function extractTextFromHtml(html: string): string {
  // Naive: strip scripts/styles then tags. For production use a proper parser.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PAGE_TEXT);
}

export interface PageText {
  text: string;
  /** Set only when the text came from an embedded JSON block. */
  imageUrl?: string;
  /** True when the markup was empty and the embedded block rescued it. */
  recoveredFromEmbedded: boolean;
}

/**
 * Reads a page's product text, falling back to its embedded data.
 *
 * The fallback is only consulted when the markup came back empty, so every
 * page that already worked keeps behaving exactly as it did.
 */
export function readPageText(html: string, finalUrl: string): PageText {
  const text = extractTextFromHtml(html);
  if (text.length >= MIN_USEFUL_TEXT) return { text, recoveredFromEmbedded: false };

  const embedded = extractEmbeddedProduct(html, finalUrl);
  if (!embedded) return { text, recoveredFromEmbedded: false };

  return {
    text: embedded.text.slice(0, MAX_PAGE_TEXT),
    ...(embedded.imageUrl ? { imageUrl: embedded.imageUrl } : {}),
    recoveredFromEmbedded: true,
  };
}
