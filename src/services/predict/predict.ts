/**
 * "Will I like this?" — a verdict on a coffee the user has *not* tried yet.
 *
 * Deliberately local and deterministic rather than a model call. A prediction
 * about someone's own palate should be arithmetic on their own history: it works
 * offline, costs nothing, cannot hallucinate a preference they never expressed,
 * and — most importantly — can show its working. "Likely an 8.8, because you have
 * rated 7 natural Ethiopians at 9.2" is checkable in a way that a paragraph of
 * generated prose is not.
 *
 * Statistically this is a weighted mean shrunk toward the user's own baseline.
 * Evidence pulls the estimate away from that baseline in proportion to how much
 * of it there is, so one top-marks cup of a Kenyan cannot declare every Kenyan a
 * certainty, while twenty of them can.
 */
import { MAX_SCORE, NEUTRAL_SCORE, clampScore } from '@/services/ratings/scale';
import type { CoffeeBean, Origin, Process, Rating, RoastLevel } from '@/types';

/**
 * Strength of the pull toward the baseline, in units of evidence weight. At
 * `PRIOR_STRENGTH` worth of matches the estimate sits halfway between the
 * baseline and what the evidence says.
 */
const PRIOR_STRENGTH = 2.5;

/**
 * How much each kind of match counts. Origin and process are the strongest
 * palate signals; a roaster is a decent proxy for house style; flavour notes are
 * noisy marketing copy, so they are individually weak and collectively capped.
 */
const ATTRIBUTE_WEIGHTS = {
  origin: 1,
  process: 0.9,
  roaster: 0.85,
  roastLevel: 0.8,
  flavour: 0.35,
} as const;

export type AttributeKind = keyof typeof ATTRIBUTE_WEIGHTS;

/** Flavour notes are many and repetitive; only the best-evidenced few count. */
const MAX_FLAVOUR_MATCHES = 4;

/** Below this, the answer is "not enough to say" regardless of the number. */
const MIN_CONFIDENCE = 0.25;

export interface AttributeStats {
  label: string;
  count: number;
  averageScore: number;
}

export interface PredictionIndex {
  roasters: Map<string, AttributeStats>;
  origins: Map<string, AttributeStats>;
  processes: Map<string, AttributeStats>;
  roastLevels: Map<string, AttributeStats>;
  flavours: Map<string, AttributeStats>;
  /** The user's overall average — what a coffee scores absent any other signal. */
  baseline: number;
  totalRatings: number;
}

export interface Evidence {
  kind: AttributeKind;
  label: string;
  count: number;
  averageScore: number;
  /** How far above or below the user's own baseline this attribute runs. */
  delta: number;
}

export type Verdict = 'love' | 'like' | 'unsure' | 'avoid';

export interface Prediction {
  /** Predicted score on the 1–10 scale, to one decimal. */
  score: number;
  /** 0–1. How much history stands behind the number. */
  confidence: number;
  verdict: Verdict;
  headline: string;
  supporting: Evidence[];
  detracting: Evidence[];
  /** Values of the candidate the history says nothing about. */
  unknowns: string[];
  /** Attributes the candidate did not supply at all. */
  missing: string[];
}

export interface Candidate {
  roaster?: string | undefined;
  origins?: Origin[] | undefined;
  process?: Process | undefined;
  roastLevel?: RoastLevel | undefined;
  tastingNotes?: string[] | undefined;
}

function key(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function accumulate(map: Map<string, AttributeStats>, label: string, score: number): void {
  const k = key(label);
  if (!k) return;
  const current = map.get(k);
  if (current) {
    // Running mean rather than a total, so the struct stays directly readable.
    current.averageScore = (current.averageScore * current.count + score) / (current.count + 1);
    current.count += 1;
    return;
  }
  map.set(k, { label: label.trim(), count: 1, averageScore: score });
}

/**
 * Builds the lookup tables from raw history.
 *
 * This intentionally does not reuse the stored `UserPreferences`: that profile is
 * truncated to each category's top five for display, so predicting from it would
 * report "no history" for a coffee from the user's sixth-favourite origin — the
 * one case where the answer matters most.
 */
export function buildIndex(beans: CoffeeBean[], ratings: Rating[]): PredictionIndex {
  const beanById = new Map(beans.map((bean) => [bean.id, bean]));

  const index: PredictionIndex = {
    roasters: new Map(),
    origins: new Map(),
    processes: new Map(),
    roastLevels: new Map(),
    flavours: new Map(),
    baseline: NEUTRAL_SCORE,
    totalRatings: ratings.length,
  };

  let total = 0;
  let counted = 0;

  for (const rating of ratings) {
    const score = rating.score;
    if (!score) continue;
    total += score;
    counted += 1;

    const bean = beanById.get(rating.beanId);
    if (!bean) continue;

    if (bean.roaster) accumulate(index.roasters, bean.roaster, score);
    if (bean.process && bean.process !== 'unknown')
      accumulate(index.processes, bean.process, score);
    if (bean.roastLevel && bean.roastLevel !== 'unknown') {
      accumulate(index.roastLevels, bean.roastLevel, score);
    }
    for (const origin of bean.origins ?? []) {
      if (origin.country) accumulate(index.origins, origin.country, score);
    }
    for (const note of bean.tastingNotes ?? []) {
      accumulate(index.flavours, note, score);
    }
  }

  if (counted > 0) index.baseline = total / counted;
  return index;
}

interface WeightedMatch {
  evidence: Evidence;
  weight: number;
}

function match(
  map: Map<string, AttributeStats>,
  value: string,
  kind: AttributeKind,
  baseline: number,
): WeightedMatch | null {
  const stats = map.get(key(value));
  if (!stats) return null;
  return {
    evidence: {
      kind,
      label: stats.label,
      count: stats.count,
      averageScore: stats.averageScore,
      delta: stats.averageScore - baseline,
    },
    // log2 so the tenth cup of something adds far less certainty than the second.
    weight: ATTRIBUTE_WEIGHTS[kind] * Math.log2(1 + stats.count),
  };
}

function verdictFor(score: number, delta: number, confidence: number): Verdict {
  // Ratings cluster around each person's own centre of gravity, so a raw score
  // is not enough: for someone who averages 8.8, a predicted 8.0 is a warning.
  // Thresholds are expressed on the 1–10 scale (specs/data-model.md).
  if (confidence < MIN_CONFIDENCE) return 'unsure';
  if (score >= 8.4 && delta >= 0.2) return 'love';
  if (score >= 7.2 && delta >= -0.3) return 'like';
  if (score >= 6) return 'unsure';
  return 'avoid';
}

const HEADLINES: Record<Verdict, string> = {
  love: 'This looks like your kind of coffee.',
  like: 'Good odds you will enjoy this.',
  unsure: 'Could go either way.',
  avoid: 'Probably not one for you.',
};

function describe(kind: AttributeKind): string {
  if (kind === 'flavour') return 'tasting notes';
  if (kind === 'roastLevel') return 'roast level';
  return kind;
}

export function predict(candidate: Candidate, index: PredictionIndex): Prediction {
  const matches: WeightedMatch[] = [];
  const unknowns: string[] = [];
  const missing: string[] = [];

  const consider = (
    value: string | undefined,
    map: Map<string, AttributeStats>,
    kind: AttributeKind,
  ): void => {
    if (!value || value === 'unknown') {
      missing.push(describe(kind));
      return;
    }
    const found = match(map, value, kind, index.baseline);
    if (found) matches.push(found);
    else unknowns.push(value);
  };

  consider(candidate.roaster, index.roasters, 'roaster');
  consider(candidate.process, index.processes, 'process');
  consider(candidate.roastLevel, index.roastLevels, 'roastLevel');

  const countries = (candidate.origins ?? []).map((o) => o.country).filter(Boolean);
  if (countries.length === 0) missing.push('origin');
  for (const country of countries) consider(country, index.origins, 'origin');

  const notes = candidate.tastingNotes ?? [];
  if (notes.length === 0) missing.push('tasting notes');
  const flavourMatches: WeightedMatch[] = [];
  for (const note of notes) {
    const found = match(index.flavours, note, 'flavour', index.baseline);
    if (found) flavourMatches.push(found);
    else unknowns.push(note);
  }
  // Only the best-evidenced notes count, so a bag listing twelve of them cannot
  // out-vote the origin and the process put together.
  flavourMatches.sort((a, b) => b.weight - a.weight);
  matches.push(...flavourMatches.slice(0, MAX_FLAVOUR_MATCHES));

  const totalWeight = matches.reduce((sum, m) => sum + m.weight, 0);
  const weighted = matches.reduce((sum, m) => sum + m.weight * m.evidence.averageScore, 0);

  const raw = (weighted + PRIOR_STRENGTH * index.baseline) / (totalWeight + PRIOR_STRENGTH);
  const score = Math.round(clampScore(raw) * 10) / 10;

  // Confidence saturates: it approaches 1 as evidence accumulates but never
  // claims certainty, and it is held back while the overall history is thin.
  const evidenceConfidence = totalWeight / (totalWeight + PRIOR_STRENGTH);
  const historyConfidence = Math.min(1, index.totalRatings / 10);
  const confidence = Math.round(evidenceConfidence * historyConfidence * 100) / 100;

  const delta = score - index.baseline;
  const verdict = verdictFor(score, delta, confidence);

  const evidence = matches.map((m) => m.evidence);
  const supporting = evidence
    .filter((e) => e.delta >= 0)
    .sort((a, b) => b.delta - a.delta || b.count - a.count);
  const detracting = evidence
    .filter((e) => e.delta < 0)
    .sort((a, b) => a.delta - b.delta || b.count - a.count);

  return {
    score,
    confidence,
    verdict,
    headline: HEADLINES[verdict],
    supporting,
    detracting,
    unknowns,
    missing: Array.from(new Set(missing)),
  };
}

/** Human-readable justification for one piece of evidence. */
export function explain(evidence: Evidence): string {
  const cups = `${evidence.count} ${evidence.count === 1 ? 'cup' : 'cups'}`;
  const average = evidence.averageScore.toFixed(1);
  switch (evidence.kind) {
    case 'roaster':
      return `You have rated ${cups} from ${evidence.label} at ${average}/${MAX_SCORE}.`;
    case 'origin':
      return `Coffees from ${evidence.label} average ${average}/${MAX_SCORE} across ${cups}.`;
    case 'process':
      return `${evidence.label} process averages ${average}/${MAX_SCORE} across ${cups}.`;
    case 'roastLevel':
      return `${evidence.label} roasts average ${average}/${MAX_SCORE} across ${cups}.`;
    case 'flavour':
      return `Coffees noting "${evidence.label}" average ${average}/${MAX_SCORE} across ${cups}.`;
  }
}
