/**
 * The single definition of what a coffee's tasting notes are once duplicates
 * are accounted for.
 *
 * A bag can list the same note twice — "Chocolate" from the roaster's own copy
 * and "chocolate" from an enrichment lookup, or a blend describing each of its
 * components. That is a harmless record of what was written. What is not
 * harmless is treating it as two pieces of evidence: one rating of one coffee
 * is one observation of that note, however many times the bag says it.
 *
 * Analytics already deduped its notes with an inline `Set` while
 * `services/preferences/compute.ts` and `services/predict/predict.ts` did not,
 * so the same bag contributed one observation of "chocolate" to one screen and
 * two to another (#301). Everything that ranks, averages or recommends now
 * reads the rule from here, for the same reason `beans/origins.ts` exists: three
 * copies of this loop is exactly how these screens lose agreement (#202).
 */

/** How a note is compared. Whitespace is collapsed because "dark  chocolate"
 * and "dark chocolate" are the same note typed differently. */
function noteKey(note: string): string {
  return note.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Each tasting note a coffee lists, once, in the order first written.
 *
 * The trimmed spelling of the first mention is what comes back; callers apply
 * their own casing, because the screens differ in how they display a note and
 * that is not this function's business. Blank notes are dropped rather than
 * counted as an empty bucket.
 */
export function uniqueTastingNotes(notes: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const note of notes ?? []) {
    const trimmed = note?.trim();
    if (!trimmed || seen.has(noteKey(trimmed))) continue;
    seen.add(noteKey(trimmed));
    out.push(trimmed);
  }
  return out;
}
