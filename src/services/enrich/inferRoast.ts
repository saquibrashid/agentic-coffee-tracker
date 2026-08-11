/**
 * Infers a roast level from text the app already holds, for coffees whose
 * roaster never filled in a structured roast field.
 *
 * Most product pages *do* state the roast — just in prose ("a classic French
 * roast", "Roast: medium-dark") rather than in a labelled field, so the parse
 * returns null and the coffee lands as `unknown`. That matters beyond display:
 * `services/preferences/compute.ts` and `services/predict/predict.ts` both skip
 * `unknown`, so an unfilled roast is a coffee the preference engine cannot
 * learn from at all.
 *
 * ## What this deliberately does not do
 *
 * It does not guess from flavour descriptors. The correlation is real —
 * floral/citrus skews light, smoky/ashy skews dark — but it is confounded by
 * origin and varietal: a natural Ethiopian keeps its fruit at a medium roast,
 * and "chocolate" is as much a Brazilian bean trait as a roast artefact. Since
 * these values feed the recommendation engine, a plausible-looking guess is
 * worse than an honest `unknown`: the user would have no way to tell that their
 * "favourite roast" was inferred from a bag that never named one.
 *
 * So every rule here keys on explicit roast *vocabulary*, and each match is
 * returned with the phrase that produced it, so callers can show their working.
 */
import type { RoastLevel } from '@/types';

export interface RoastInference {
  level: RoastLevel;
  /** The exact phrase that produced the match, for display and debugging. */
  evidence: string;
}

/**
 * Modifier phrases, mapped to the enum.
 *
 * The traditional degree names follow the usual progression — cinnamon is
 * pulled at first crack, full city just before second, and anything past second
 * crack is dark. `city` and `full city` match the spellings already accepted by
 * the ratings importer's roast column, so a value typed into a spreadsheet and
 * the same value found in prose resolve identically.
 */
const MODIFIERS: ReadonlyArray<readonly [string, RoastLevel]> = [
  // Longest first: "medium dark" must win before "medium" or "dark" can match.
  ['medium dark', 'medium-dark'],
  ['dark medium', 'medium-dark'],
  ['medium light', 'medium-light'],
  ['light medium', 'medium-light'],
  ['full city plus', 'medium-dark'],
  ['full city', 'medium-dark'],
  ['city plus', 'medium'],
  ['cinnamon', 'light'],
  ['blonde', 'light'],
  ['blond', 'light'],
  ['vienna', 'dark'],
  ['french', 'dark'],
  ['italian', 'dark'],
  ['city', 'medium'],
  ['light', 'light'],
  ['medium', 'medium'],
  ['dark', 'dark'],
];

/**
 * `espresso` is absent on purpose.
 *
 * The ratings importer maps an explicit `roast: espresso` column to
 * medium-dark, which is defensible when someone typed it into a roast field.
 * Inferring it from prose is not: "Espresso Blend" and "Espresso Roast" are
 * product names, and a large part of specialty roasting deliberately serves
 * espresso light. Reading a roast level out of an intended *brew method* would
 * mislabel exactly the coffees whose roast the user cares most about.
 */

/**
 * Normalises text so one set of patterns can match every spelling.
 *
 * Hyphens become spaces, so "medium-dark", "medium–dark" and "medium dark" are
 * one case. Everything else that is not a letter or digit becomes a space too,
 * which is what lets a match survive punctuation like "Roast: dark." or
 * "(medium roast)".
 *
 * Sentence terminators survive as a bare `.`, because the negation check below
 * needs to know where one sentence ends. Without them "We do not cut corners.
 * Roast level: dark." reads as a single run of words, and the `not` from the
 * first sentence would suppress the plain statement in the second.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+.!?;]+/g, ' ')
    .replace(/[.!?;]+/g, ' . ')
    .replace(/\+/g, ' plus ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALTERNATION = MODIFIERS.map(([phrase]) => phrase.replace(/ /g, '\\s+')).join('|');

/**
 * The modifier sits before the word: "dark roast", "medium roasted",
 * "light roast profile".
 */
const BEFORE = new RegExp(`\\b(${ALTERNATION})\\s+roast(?:ed|ing)?\\b`);

/**
 * The modifier sits after it, usually as a label: "roast: dark",
 * "roast level medium dark", "roasted light".
 */
const AFTER = new RegExp(
  `\\broast(?:ed|ing)?\\s*(?:level|degree|profile|style|type)?\\s*(${ALTERNATION})\\b`,
);

/**
 * Phrases specific enough to name a roast on their own.
 *
 * Restricted to the traditional degree names, which have no other meaning in a
 * coffee listing. Bare `city` is excluded — it is a word that turns up in
 * roaster names and addresses ("Kansas City", "Queen City Collective") — as are
 * the bare modifiers `light`, `medium` and `dark`, which is the whole reason
 * "dark chocolate" and "light body" do not produce a match.
 */
const STANDALONE: ReadonlyArray<readonly [RegExp, RoastLevel]> = [
  [/\bfull\s+city\s+plus\b/, 'medium-dark'],
  [/\bfull\s+city\b/, 'medium-dark'],
  [/\bcity\s+plus\b/, 'medium'],
];

function levelFor(modifier: string): RoastLevel | undefined {
  const normalised = modifier.replace(/\s+/g, ' ');
  return MODIFIERS.find(([phrase]) => phrase === normalised)?.[1];
}

/**
 * Cues that invert the phrase that follows them.
 *
 * "Not your typical dark roast" and "none of the bitterness of a French roast"
 * are ordinary roaster copy, and both name a roast the coffee explicitly is
 * *not*. Without this the module would read them as assertions and record the
 * opposite of what the page says.
 *
 * Only the text since the last sentence boundary is considered, and only a
 * short run of it — far enough to catch the standard constructions, short
 * enough that a negation in a previous sentence cannot reach across and
 * suppress a genuine mention.
 */
const NEGATIONS =
  /\b(?:not|isn t|aren t|never|unlike|instead of|rather than|none of|short of|without|no)\b[^.]{0,24}$/;

function isNegated(haystack: string, matchIndex: number): boolean {
  return NEGATIONS.test(haystack.slice(0, matchIndex));
}

/**
 * Reads a roast level out of a single string, or returns null.
 *
 * Exported for the tests, and for any caller that wants to inspect one field on
 * its own rather than the merged bean text.
 */
export function inferRoastFromText(text: string): RoastInference | null {
  const haystack = normalise(text);
  if (haystack === '') return null;

  for (const pattern of [BEFORE, AFTER]) {
    const match = pattern.exec(haystack);
    const modifier = match?.[1];
    if (match && modifier !== undefined && !isNegated(haystack, match.index)) {
      const level = levelFor(modifier);
      if (level) return { level, evidence: match[0] };
    }
  }

  for (const [pattern, level] of STANDALONE) {
    const match = pattern.exec(haystack);
    if (match && !isNegated(haystack, match.index)) {
      return { level, evidence: match[0] };
    }
  }

  return null;
}

/** The text fields a roast level may be read out of, most authoritative first. */
export interface RoastInferenceInput {
  name?: string | undefined;
  roasterDescription?: string | undefined;
  tastingNotes?: readonly string[] | undefined;
}

/**
 * Infers a roast level for a coffee, or returns null when the text does not
 * name one.
 *
 * The name is consulted first and the tasting notes last, in decreasing order
 * of how deliberate the mention is. A roaster who calls a coffee "French Roast"
 * has named the roast; a stray "dark" in a note list has not, which is why
 * notes only ever match through the same explicit-vocabulary rules and never on
 * a flavour word alone.
 */
export function inferRoastLevel(input: RoastInferenceInput): RoastInference | null {
  const fields = [input.name, input.roasterDescription, (input.tastingNotes ?? []).join(', ')];

  for (const field of fields) {
    if (!field) continue;
    const found = inferRoastFromText(field);
    if (found) return found;
  }

  return null;
}
