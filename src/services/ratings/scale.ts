/**
 * The rating scale, in one place.
 *
 * `specs/data-model.md` has always specified `score ∈ {1, 1.5, ... 10}`; the
 * first implementation shipped a 1–5 integer control and the rest of the app
 * grew around that. Centralising the bounds here means the form, the importer,
 * the analytics histogram and the prediction engine can no longer drift apart,
 * and the legacy conversion has exactly one definition.
 */

export const MIN_SCORE = 1;
export const MAX_SCORE = 10;
/** Halves are allowed; finer steps imply a precision tasting notes don't have. */
export const SCORE_STEP = 0.5;

/** The midpoint, used when there is no history to reason from. */
export const NEUTRAL_SCORE = (MIN_SCORE + MAX_SCORE) / 2;

/** The upper bound of the original scale, kept only for converting old data. */
export const LEGACY_MAX_SCORE = 5;

export function isValidScore(score: number): boolean {
  if (!Number.isFinite(score)) return false;
  if (score < MIN_SCORE || score > MAX_SCORE) return false;
  return Math.round(score / SCORE_STEP) === score / SCORE_STEP;
}

/** Rounds to the nearest legal step and clamps into range. */
export function clampScore(score: number): number {
  const stepped = Math.round(score / SCORE_STEP) * SCORE_STEP;
  const bounded = Math.min(MAX_SCORE, Math.max(MIN_SCORE, stepped));
  // Guards against 0.30000000000000004 style drift from the divide/multiply.
  return Math.round(bounded * 2) / 2;
}

/**
 * Converts a score recorded on the old 1–5 scale.
 *
 * Doubling is used rather than a linear remap of the endpoints (which would
 * send 1→1 and 5→10 via `(s-1) * 9/4 + 1`) because doubling keeps every value
 * on a legal half-step, preserves the ordering and the ratio between any two
 * ratings, and is the mapping a person actually expects: a 4/5 becomes an 8/10.
 * The cost is that no migrated rating lands on 1, which is harmless — the old
 * scale's floor was 1/5 = "undrinkable", and 2/10 says the same thing.
 */
export function rescaleLegacyScore(score: number): number {
  return clampScore(score * (MAX_SCORE / LEGACY_MAX_SCORE));
}

/** Renders a score without a pointless trailing `.0`. */
export function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

/** e.g. `8.5/10` — the form used in copy and explanations. */
export function formatOutOf(score: number): string {
  return `${formatScore(score)}/${MAX_SCORE}`;
}

/**
 * Every selectable score, best first. Descending because the common case is a
 * coffee worth logging, so the likely answers sit at the top of the list.
 */
export const SCORE_CHOICES: number[] = Array.from(
  { length: (MAX_SCORE - MIN_SCORE) / SCORE_STEP + 1 },
  (_, i) => MAX_SCORE - i * SCORE_STEP,
);

/** Pre-selected in the rating form — the old default of 4/5, restated. */
export const DEFAULT_SCORE = 8;

/** Snaps an arbitrary number onto the nearest legal half-step. */
export function roundToStep(score: number): number {
  return Math.round(score / SCORE_STEP) * SCORE_STEP;
}
