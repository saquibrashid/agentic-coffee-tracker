/**
 * Infers whether a bag holds one coffee or several, from text the app has.
 *
 * Roasters say this plainly and prominently, but almost never in a labelled
 * field: it is a word in the product title or a banner above the name. Every
 * string below is real, taken from a page this app reads today —
 *
 *   "Holler Mountain Blend – Whole Bean Coffee | Stumptown"   -> blend
 *   "Hair Bender Coffee Blend | Stumptown ... BLEND"           -> blend
 *   "Year-Round Blend" (Counter Culture, Fast Forward)         -> blend
 *   "EXCLUSIVE SINGLE ORIGIN Sunrider"                         -> single origin
 *   "SINGLE ORGIN Honduras El Puente Natural"                  -> single origin
 *
 * — including the misspelling in the last one, which is Stumptown's own and is
 * live as this is written. A rule that only works on correctly spelled
 * marketing copy does not work on marketing copy.
 *
 * ## Why the catalogue is not consulted
 *
 * Stumptown files Sunrider under `Coffee/Blends`, and Sunrider is a single
 * origin — its own page says so twice. The shop's navigation is a merchandising
 * choice; the product page is a claim about the coffee. Only the second is
 * evidence. For the same reason `origins.length` is not used either: entries
 * there can be two producers at one washing station as easily as two lots from
 * two countries, so counting them would invent a blend out of a well-documented
 * single origin.
 *
 * ## Why silence is not evidence
 *
 * Blue Bottle's page for Night Light Decaf uses neither word. Unlike caffeine —
 * where "no mention of decaf" really does mean caffeinated, because decaf is
 * the marked case — composition has no unmarked default: blends and single
 * origins are both entirely ordinary, and a page that says nothing has told us
 * nothing. So this returns `undefined` rather than picking the commoner one.
 *
 * ## Why both words means giving up
 *
 * A blend's page can mention the single origins it is made from, and a single
 * origin's page can mention the blends it goes into. When both words survive as
 * plain assertions there is no way to tell which describes the bag, and a coin
 * flip would be recorded as fact.
 *
 * Negation is applied first and settles the simplest of these ("this is not a
 * blend"), but it does not rescue a contrast drawn inside one sentence:
 * "Unlike a single origin, this blend stays consistent" puts `unlike` within
 * reach of *both* words, so both are discarded and the scope abstains. That is
 * a classification lost rather than one invented, which is the direction this
 * module errs in throughout — `composition` reaches the preference and
 * prediction maths, and a wrong value there is worse than a missing one.
 *
 * Scopes are searched narrowest-first, because a product's own name is about
 * that product and nothing else, and a name that has already answered never
 * reaches the noisier text below it.
 */
import { isNegated, normalise } from '@/services/enrich/textEvidence';
import type { Composition } from '@/types';

export interface CompositionInference {
  composition: Exclude<Composition, 'unknown'>;
  /** The phrase that produced the match, so callers can show their working. */
  evidence: string;
}

/**
 * "Single origin", hyphenated or not, singular or plural, and tolerant of the
 * dropped `i` Stumptown ships on at least one live page. Written as one pattern
 * rather than a list of spellings because the case that breaks it is always a
 * page nobody has looked at yet.
 */
const SINGLE_ORIGIN = /\bsingle\s?or[i]?g[i]?ns?\b/g;

/**
 * "Blend" or "blends", as a whole word.
 *
 * `blended` is excluded deliberately: it is overwhelmingly a verb about
 * preparation ("blended with steamed milk"), not a statement that the bag holds
 * more than one coffee.
 */
const BLEND = /\bblends?\b/g;

/** The first occurrence that is not inside a negated construction. */
function firstAssertion(pattern: RegExp, haystack: string): string | undefined {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(haystack); match; match = pattern.exec(haystack)) {
    if (!isNegated(haystack, match.index)) return match[0];
  }
  return undefined;
}

function readScope(text: string): CompositionInference | undefined {
  const haystack = normalise(text);
  const blend = firstAssertion(BLEND, haystack);
  const single = firstAssertion(SINGLE_ORIGIN, haystack);

  if (blend && single) return undefined;
  if (blend) return { composition: 'blend', evidence: blend };
  if (single) return { composition: 'single-origin', evidence: single };
  return undefined;
}

export interface CompositionInferenceInput {
  name?: string | undefined;
  roasterDescription?: string | undefined;
  /** The scraped product page, when a lookup has one. */
  pageText?: string | undefined;
}

/**
 * Returns a match, or `undefined` when the text says nothing either way.
 *
 * Scopes are tried narrowest-first. A product name is about that product, so it
 * decides alone; a description is mostly about the product; a whole page is
 * partly about the shop's other coffees, so it is consulted last and is the
 * scope most likely to hold both words and therefore to abstain.
 */
export function inferComposition(
  input: CompositionInferenceInput,
): CompositionInference | undefined {
  for (const scope of [input.name, input.roasterDescription, input.pageText]) {
    if (typeof scope !== 'string' || scope.trim() === '') continue;
    const found = readScope(scope);
    if (found) return found;
  }
  return undefined;
}
