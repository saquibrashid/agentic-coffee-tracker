/**
 * Infers caffeine content from text the app already holds.
 *
 * Roasters overwhelmingly put this in the product *name* — "Night Light Decaf",
 * "After Hours Decaf" — rather than in a labelled field, and the parse prompt
 * is told not to guess, so those come back null. That is the same gap
 * `inferRoast.ts` exists to close, and it matters for the same reason: a coffee
 * left `unknown` is one the preference engine cannot separate, which is the
 * whole point of recording caffeine at all.
 *
 * ## The asymmetry that shapes this file
 *
 * Decaf is *marked* and caffeinated is *unmarked*. A roaster selling decaf says
 * so prominently, because it is the reason someone buys it. A roaster selling
 * ordinary coffee says nothing, because there is nothing to say. So finding
 * "decaf" is strong evidence, while finding no mention of caffeine is no
 * evidence at all — it describes almost every bag ever printed.
 *
 * Nothing here therefore ever returns `caffeinated`. Absence stays `unknown`,
 * and `unknown` is treated as comparable with everything by
 * `services/beans/caffeine.ts`, so an unmarked coffee behaves exactly as it did
 * before this field existed.
 */
import type { CaffeineLevel } from '@/types';

export interface CaffeineInference {
  level: CaffeineLevel;
  /** The exact phrase that produced the match, so callers can show their working. */
  evidence: string;
}

/**
 * Phrases that name the answer outright, longest first so "half caf" is not
 * shadowed by a bare "caf" and "swiss water" is credited before any generic
 * decaf wording elsewhere in the same text.
 *
 * The decaffeination methods are here because a product page frequently names
 * the process instead of the word: "Sugarcane EA" or "Swiss Water Process" is
 * the roaster telling you it is decaf in the vocabulary of someone who assumes
 * you already know.
 *
 * `methodOnly` marks the phrases that are safe to read out of a roaster's prose
 * as well as out of the name. The distinction exists because a description is
 * marketing copy about a catalogue, not just about this bag: "also available as
 * a decaf" and "unlike our decaf" both appear on pages for fully caffeinated
 * coffee, and matching them would label the wrong bean. Naming a
 * decaffeination process is different — nobody describes how a coffee was
 * decaffeinated unless it was.
 */
const PHRASES: ReadonlyArray<{
  readonly phrase: string;
  readonly level: CaffeineLevel;
  readonly inProse: boolean;
}> = [
  { phrase: 'half caf', level: 'half-caf', inProse: false },
  { phrase: 'half-caf', level: 'half-caf', inProse: false },
  { phrase: 'halfcaf', level: 'half-caf', inProse: false },
  { phrase: 'half caff', level: 'half-caf', inProse: false },
  { phrase: 'half-caff', level: 'half-caf', inProse: false },
  { phrase: 'swiss water', level: 'decaf', inProse: true },
  { phrase: 'sugarcane ea', level: 'decaf', inProse: true },
  { phrase: 'ethyl acetate', level: 'decaf', inProse: true },
  { phrase: 'decaffeinated', level: 'decaf', inProse: false },
  { phrase: 'decaffeination', level: 'decaf', inProse: false },
  { phrase: 'decaf', level: 'decaf', inProse: false },
];

/**
 * Word-boundary match, so a decaf mention has to be a word rather than a
 * fragment.
 *
 * Without it "decaf" would match inside a longer word and, more importantly,
 * `caf` variants would match parts of ordinary words. The boundary is checked
 * by hand rather than with `\b` because several phrases contain spaces and
 * hyphens, which `\b` treats inconsistently at the edges.
 */
function containsPhrase(haystack: string, phrase: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(phrase, from);
    if (at === -1) return false;

    const before = at === 0 ? ' ' : haystack[at - 1];
    const afterIndex = at + phrase.length;
    const after = afterIndex >= haystack.length ? ' ' : haystack[afterIndex];

    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[a-z0-9]/.test(char);
}

export interface CaffeineInferenceInput {
  name?: string | undefined;
  roasterDescription?: string | undefined;
}

/**
 * Returns a match, or `undefined` when the text says nothing about caffeine.
 *
 * The name is searched for every phrase; the roaster's description only for
 * phrases naming a decaffeination method, for the reason given on `PHRASES`.
 *
 * Tasting notes are deliberately not consulted, unlike the roast inference.
 * They describe the cup, and a decaf's flavour descriptors are the same words a
 * caffeinated coffee uses -- there is no signal there to find, only ways to be
 * wrong.
 */
export function inferCaffeine(input: CaffeineInferenceInput): CaffeineInference | undefined {
  const name = (input.name ?? '').toLowerCase();
  const prose = [input.name, input.roasterDescription]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();

  for (const { phrase, level, inProse } of PHRASES) {
    const haystack = inProse ? prose : name;
    if (containsPhrase(haystack, phrase)) return { level, evidence: phrase };
  }
  return undefined;
}
