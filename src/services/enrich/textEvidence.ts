/**
 * Shared text handling for the inference modules.
 *
 * `inferRoast` grew both of these first and they are not specific to roast:
 * any module reading a claim out of roaster prose has to cope with the same
 * punctuation and the same habit roasters have of naming the thing a coffee
 * *isn't*. `inferComposition` needs them verbatim — "Not your typical espresso
 * blend" is the same sentence shape as "Not your typical dark roast" — and a
 * second hand-rolled copy of the negation pattern would be a copy that drifts.
 */

/**
 * Normalises text so one set of patterns can match every spelling.
 *
 * Hyphens become spaces, so "medium-dark", "medium–dark" and "medium dark" are
 * one case, and "single-origin" and "single origin" likewise. Everything else
 * that is not a letter or digit becomes a space too, which is what lets a match
 * survive punctuation like "Roast: dark." or "(medium roast)".
 *
 * Sentence terminators survive as a bare `.`, because the negation check below
 * needs to know where one sentence ends. Without them "We do not cut corners.
 * Roast level: dark." reads as a single run of words, and the `not` from the
 * first sentence would suppress the plain statement in the second.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+.!?;]+/g, ' ')
    .replace(/[.!?;]+/g, ' . ')
    .replace(/\+/g, ' plus ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cues that invert the phrase that follows them.
 *
 * "Not your typical dark roast" and "none of the bitterness of a French roast"
 * are ordinary roaster copy, and both name a roast the coffee explicitly is
 * *not*. Without this the modules would read them as assertions and record the
 * opposite of what the page says.
 *
 * Only the text since the last sentence boundary is considered, and only a
 * short run of it — far enough to catch the standard constructions, short
 * enough that a negation in a previous sentence cannot reach across and
 * suppress a genuine mention.
 */
const NEGATIONS =
  /\b(?:not|isn t|aren t|never|unlike|instead of|rather than|none of|short of|without|no)\b[^.]{0,24}$/;

export function isNegated(haystack: string, matchIndex: number): boolean {
  return NEGATIONS.test(haystack.slice(0, matchIndex));
}
