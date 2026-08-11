/**
 * Turns a coffee's name into store-search queries, and ranks what comes back.
 *
 * A storefront's product search demands that *every* word in the query appear
 * in the product, so one unrecognised word sinks the whole lookup. A ratings
 * spreadsheet is full of exactly those words, because people abbreviate when
 * they type: "Holler Mtn." finds nothing on Stumptown's store, while "Holler
 * Mountain" and even bare "Holler" both return the coffee.
 *
 * So a single query is not enough. This module builds a ladder of progressively
 * looser queries and, because a looser query also drags in coffees that merely
 * share a word, scores every result back against the name the user actually
 * wrote so the closest product wins and unrelated ones are discarded.
 */

/**
 * Abbreviations worth expanding, restricted to ones with no other plausible
 * reading in a coffee name.
 *
 * Deliberately excluded: `no` (as in "No. 9"), `st` (Street or Saint) and `co`
 * (Company or Colombia), which are ambiguous enough that expanding them would
 * break more lookups than it fixes. The ladder's word-dropping step is the
 * general safety net for anything not listed here, so this map only has to
 * cover the common cases to be useful.
 */
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  mtn: 'mountain',
  mtns: 'mountains',
  mt: 'mount',
  bros: 'brothers',
  bro: 'brother',
  hse: 'house',
  blk: 'black',
  dk: 'dark',
  med: 'medium',
  lt: 'light',
  orig: 'original',
  ed: 'edition',
  vly: 'valley',
  rvr: 'river',
  crk: 'creek',
  spr: 'spring',
  hts: 'heights',
  rd: 'road',
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
};

/**
 * Words that describe the packaging or the category rather than the coffee.
 *
 * They carry almost no identifying weight — every product on the site is a
 * coffee — so they are the first thing dropped when a query needs loosening,
 * and they count for little when scoring. `decaf` is pointedly absent: it
 * distinguishes two genuinely different products with the same name.
 */
const GENERIC = new Set([
  'coffee',
  'coffees',
  'blend',
  'blends',
  'roast',
  'roasted',
  'bean',
  'beans',
  'whole',
  'ground',
  'bag',
  'lb',
  'oz',
  'organic',
]);

/** Words too common to mean anything on their own. */
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'of', 'with', 'for', 'in', 'by']);

/**
 * Splits text into comparable words.
 *
 * Punctuation goes first, which is what collapses "Mtn." and "Mtn" onto one
 * token, and `&` becomes `and` so it can then be dropped as a stopword rather
 * than surviving as noise.
 */
export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .map((token) => ABBREVIATIONS[token] ?? token);
}

/**
 * The queries to try, loosest last.
 *
 * The name as written comes first so an exact product match is always
 * preferred, and each later rung gives up a little more precision: expanded
 * abbreviations, then the packaging words, then trailing words one at a time.
 * Trailing words go before leading ones because the distinctive part of a
 * coffee's name is nearly always at the front — "Holler" identifies the coffee,
 * "Mtn." only qualifies it.
 *
 * Capped, because every rung is an HTTP round-trip against a store that may be
 * slow, and a name that has not matched in four attempts is not going to.
 */
export function buildQueryLadder(name: string, max = 4): string[] {
  const ladder: string[] = [];
  const add = (query: string) => {
    const trimmed = query.trim();
    if (trimmed.length > 0 && !ladder.includes(trimmed)) ladder.push(trimmed);
  };

  add(name);

  const expanded = tokenise(name);
  add(expanded.join(' '));

  const distinctive = expanded.filter((token) => !GENERIC.has(token));
  add(distinctive.join(' '));

  // Never drop the last remaining word: a bare one-word query is broad enough
  // already, and going further would mean searching for nothing at all.
  const base = distinctive.length > 0 ? distinctive : expanded;
  for (let end = base.length - 1; end >= 1; end -= 1) {
    add(base.slice(0, end).join(' '));
  }

  return ladder.slice(0, max);
}

/**
 * How well a product title matches the name that was asked for, from 0 to 1.
 *
 * Coverage of the *requested* words drives the score: a title has to account
 * for what the user wrote, not the other way round. Extra words are only
 * lightly penalised, because a store legitimately dresses its titles up
 * ("Ground Holler Mountain", "Holler Mountain 12oz") and those are still the
 * right coffee — just a slightly worse answer than the plain listing.
 *
 * Packaging words count for little on both sides, so "Holler Mountain" cannot
 * be beaten by a coffee that merely happens to share the word "Blend".
 */
export function scoreMatch(name: string, title: string): number {
  const wanted = tokenise(name);
  if (wanted.length === 0) return 0;

  const have = new Set(tokenise(title));
  const weigh = (token: string) => (GENERIC.has(token) ? 0.2 : 1);

  let matched = 0;
  let total = 0;
  for (const token of wanted) {
    const weight = weigh(token);
    total += weight;
    if (have.has(token)) matched += weight;
  }
  if (total === 0) return 0;

  const coverage = matched / total;

  // Every surplus word costs a little, so the plain listing edges out the
  // variants of it — "Holler Mountain" should beat "Ground Holler Mountain",
  // which is the same coffee described more specifically than was asked for.
  // Packaging words cost less, since they say nothing about which coffee it is.
  const surplus = [...have].filter((token) => !wanted.includes(token));
  const penalty = surplus.reduce((sum, token) => sum + (GENERIC.has(token) ? 0.01 : 0.03), 0);

  return Math.max(0, coverage - penalty);
}

export interface RankableHit {
  url: string;
  title: string;
  snippet: string;
  /** The bare product title, without any vendor suffix added for display. */
  productTitle: string;
}

/**
 * Orders results by how well they match, and drops the ones that do not.
 *
 * The floor matters more than the order. A loosened query reaches products that
 * share a single word with the coffee — searching Stumptown for "Holler"
 * surfaces "Homestead" too — and auto-enrichment takes the top result without
 * asking anyone, so a plausible-looking wrong answer would silently overwrite a
 * coffee's details. Anything that fails to account for a real part of the name
 * is therefore discarded rather than ranked last.
 */
export function rankHits<T extends RankableHit>(
  name: string,
  hits: readonly T[],
  floor = 0.5,
): T[] {
  return hits
    .map((hit) => ({ hit, score: scoreMatch(name, hit.productTitle) }))
    .filter((entry) => entry.score >= floor)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.hit);
}

/**
 * Words that appear in a roaster's name but not usually in its domain.
 *
 * "Stumptown Coffee Roasters" trades at `stumptowncoffee.com`, and "High Wire
 * Coffee Roasters" at `highwirecoffee.com` — in both cases the trailing trade
 * words are dropped or partly dropped. Stripping them yields the distinctive
 * part that the domain is actually built from.
 */
const GENERIC_ROASTER_WORDS = new Set([
  'coffee',
  'coffees',
  'roasters',
  'roaster',
  'roasting',
  'roastery',
  'roasterie',
  'co',
  'company',
  'the',
  'and',
]);

/**
 * Guesses the roaster's own storefront domain from its name alone.
 *
 * The model is asked for this first, and is better at the awkward cases — a
 * national TLD, or a name that bears no relation to the domain. But it answers
 * from recognition, so it goes quiet on smaller roasters and, more subtly, on
 * ones whose name it has only seen spelled differently: it resolves "Highwire
 * Coffee Roasters" and not "High Wire Coffee Roasters", which is how a coffee
 * whose product page exists came back with nothing at all.
 *
 * These candidates cost nothing to produce and are checked by simply asking
 * each one for a product, so a domain that does not exist or is not a store
 * falls out on its own. Measured against real roasters, this resolves the large
 * majority without the model needing to recognise anything.
 */
export function roasterDomainCandidates(roaster: string, max = 5): string[] {
  const all = roaster
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (all.length === 0) return [];

  const core = all.filter((token) => !GENERIC_ROASTER_WORDS.has(token));
  const distinctive = (core.length > 0 ? core : all).join('');
  const verbatim = all.join('');

  const candidates: string[] = [];
  const add = (domain: string) => {
    // Two characters before the suffix is not a roaster name, it is a typo.
    if (domain.length > 6 && !candidates.includes(domain)) candidates.push(domain);
  };

  add(`${distinctive}coffee.com`);
  add(`${verbatim}.com`);
  add(`${distinctive}.com`);
  add(`${distinctive}coffeeroasters.com`);
  add(`${distinctive}roasters.com`);

  return candidates.slice(0, max);
}
