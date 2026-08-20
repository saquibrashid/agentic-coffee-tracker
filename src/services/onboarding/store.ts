import { db } from '@/services/db';

/**
 * Where onboarding state lives, and why it is not synced.
 *
 * `meta` is local to the device and never enters the outbox, so nothing here
 * can be resurrected by a sync — which is the one behaviour a dismissed hint
 * must never have (#241). The cost is that dismissals do not travel between a
 * user's devices; that is acceptable because the hints are gated on data first,
 * and the data *does* travel. A second device with a synced history is already
 * past every hint, so it stays quiet without needing to know what was dismissed
 * on the first one. Only a genuinely new user on a second device sees them
 * again, which is the case where showing them is right anyway.
 */

const KEY = 'onboarding';

export interface OnboardingState {
  dismissed: string[];
  visited: string[];
}

const EMPTY: OnboardingState = { dismissed: [], visited: [] };

function parse(value: unknown): OnboardingState {
  if (typeof value !== 'object' || value === null) return EMPTY;
  const record = value as Partial<OnboardingState>;
  return {
    dismissed: Array.isArray(record.dismissed) ? record.dismissed.filter(isString) : [],
    visited: Array.isArray(record.visited) ? record.visited.filter(isString) : [],
  };
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export async function readOnboarding(): Promise<OnboardingState> {
  const record = await db.meta.get(KEY);
  return parse(record?.value);
}

async function update(
  change: (state: OnboardingState) => OnboardingState,
): Promise<OnboardingState> {
  const next = change(await readOnboarding());
  await db.meta.put({ key: KEY, value: next });
  return next;
}

export async function dismissHint(id: string): Promise<void> {
  await update((state) =>
    state.dismissed.includes(id) ? state : { ...state, dismissed: [...state.dismissed, id] },
  );
}

/**
 * Records that a route was actually opened.
 *
 * This is what lets a hint stop nagging about a page the user found on their
 * own, rather than only when they take the hint's own button. Without it,
 * "Recommendations are ready" would keep sitting on Home for someone who has
 * been using For you daily.
 */
export async function markVisited(path: string): Promise<void> {
  await update((state) =>
    state.visited.includes(path) ? state : { ...state, visited: [...state.visited, path] },
  );
}

/**
 * Puts every hint back in play.
 *
 * Deliberately does not clear `visited`: the walkthrough in Settings is the
 * replayable explanation, and re-showing "you have never opened For you" to
 * someone who has would be a false statement rather than a reminder.
 */
export async function resetHints(): Promise<void> {
  await update((state) => ({ ...state, dismissed: [] }));
}
