/**
 * Finds a coffee's product page with a general web search.
 *
 * The store-search path in `search.ts` is free and resolves most roasters, but
 * it can only see roasters who sell through Shopify. Blue Bottle does not, so
 * no amount of better domain guessing would ever have found it. A general web
 * search has no such blind spot: it finds the page regardless of the platform
 * or how the domain is spelled.
 *
 * This runs as a **fallback**, only when the free path has already come back
 * empty, because unlike that path it costs money on every call.
 *
 * ## Why citations rather than the model's prose
 *
 * The rule that shaped the original endpoint still holds: a model asked for a
 * product URL invents plausible paths that 404. Nothing here asks it to. Only
 * the `url_citation` annotations are read, and those are pages the search index
 * actually returned — the model's job is reduced to choosing which of the pages
 * it was shown to cite.
 *
 * The prose it writes around them is discarded entirely.
 */

import {
  callResponses,
  type OpenAiConfig,
  type ResponsesTool,
  type UrlCitation,
} from './openai.js';
import { rankHits, type RankableHit } from './productSearch.js';

/**
 * Sites that carry coffee but are never the roaster's own page.
 *
 * Kept deliberately short, and it is a floor rather than a fence: the ranker
 * does the real filtering. These are here because they are the results a search
 * for a coffee most often turns up *instead* of the roaster, and a marketplace
 * listing is a poor source — third-party descriptions drift from the roaster's
 * own, and the listing outlives the product.
 */
const NOT_A_ROASTER = [
  'amazon.',
  'ebay.',
  'walmart.',
  'target.',
  'instacart.',
  'facebook.',
  'instagram.',
  'reddit.',
  'youtube.',
  'pinterest.',
  'yelp.',
  'wikipedia.',
];

/**
 * The search is told to find the roaster's own store, and told what to do when
 * it cannot.
 *
 * The instruction to stay silent matters more than it looks. A model that must
 * produce something will cite the closest page it saw — a category listing, a
 * review, a different coffee by the same roaster — and unattended enrichment
 * takes the first candidate without asking anyone. Saying nothing is a correct
 * answer here; a near miss is not.
 */
const SEARCH_SYSTEM_PROMPT = [
  "You find the page on a coffee roaster's own online store where a specific coffee is sold.",
  'Search the web, then cite only the product page for exactly that coffee.',
  "Prefer the roaster's own store over any retailer, marketplace or review site.",
  'Do not cite category pages, blog posts, or a different coffee by the same roaster.',
  'If you cannot find that exact coffee, say so and cite nothing.',
].join(' ');

export function isPlausibleProductPage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return !NOT_A_ROASTER.some((blocked) => host.startsWith(blocked));
}

/**
 * Turns cited pages into rankable hits.
 *
 * The whole page title is used for scoring, including the roaster suffix that
 * store search deliberately strips. There is no separating the two here — a web
 * result has one title — and the ranker's surplus-word penalty is small enough
 * that "Night Light Decaf - Blue Bottle Coffee" still comfortably clears the
 * floor for "Night Light Decaf".
 */
export function citationsToHits(citations: readonly UrlCitation[]): RankableHit[] {
  return citations.flatMap((citation) => {
    if (!isPlausibleProductPage(citation.url) || citation.title.length === 0) return [];
    return [
      {
        url: citation.url,
        title: citation.title,
        snippet: '',
        productTitle: citation.title,
      },
    ];
  });
}

const WEB_SEARCH_TOOL: ResponsesTool = {
  type: 'web_search',
  // Measured against real roasters: `low` costs about 10% fewer tokens and
  // loses results outright — it failed to find High Wire's After Hours Decaf
  // that `medium` finds. A missed coffee costs the user more than the tokens.
  search_context_size: 'medium',
};

/**
 * Whether the paid fallback may run.
 *
 * On by default, since a search that finds nothing is the failure this exists
 * to fix, but switchable off without a redeploy because the cost is per lookup
 * and an import can fire dozens at once.
 */
export function isWebSearchEnabled(): boolean {
  const setting = process.env['WEB_SEARCH_ENABLED'];
  return setting !== 'false' && setting !== '0';
}

export interface WebSearchLogger {
  log: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
}

/**
 * Returns product pages matching the coffee, best first, or an empty list.
 *
 * Never throws: this is the last thing tried before giving up, so a failure
 * here should leave the caller exactly where it already was.
 */
export async function searchWeb(
  config: OpenAiConfig,
  roaster: string,
  name: string,
  max: number,
  ctx: WebSearchLogger,
): Promise<RankableHit[]> {
  let citations: UrlCitation[];
  try {
    const result = await callResponses(config, {
      system: SEARCH_SYSTEM_PROMPT,
      user: `Roaster: ${roaster}\nCoffee: ${name}`,
      tools: [WEB_SEARCH_TOOL],
      // Without this the model answers about coffees it happens to recognise
      // and never searches, which is exactly the failure mode being replaced.
      toolChoice: 'required',
      // The tool makes a real search and reads pages before answering, so this
      // is far slower than a plain completion.
      timeoutMs: 45_000,
    });
    citations = result.citations;
  } catch (err) {
    ctx.warn('web search failed', { error: err instanceof Error ? err.message : String(err) });
    return [];
  }

  const ranked = rankHits(name, citationsToHits(citations));
  ctx.log('web search finished', { cited: citations.length, kept: ranked.length });
  return ranked.slice(0, max);
}
