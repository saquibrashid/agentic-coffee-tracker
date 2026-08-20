import { MIN_RATINGS_FOR_RECOMMENDATIONS } from '@/services/preferences/compute';

/**
 * Which single piece of guidance, if any, is worth showing right now.
 *
 * A first-launch modal tour was the obvious answer and the wrong one (#241): it
 * fires when the user has no data, so every feature has to be explained in the
 * abstract against empty screens, and it arrives before the user has any
 * question it could answer. Dismissing it is usually permanent.
 *
 * These hints are data-aware instead. Each becomes true at the moment the thing
 * it describes becomes worth doing, and stops being true once the user is past
 * it — so a returning user with a real history sees none of them without ever
 * having dismissed anything. That is also what keeps a second device quiet: the
 * conditions are evaluated against synced data, not against a per-device
 * "have I shown this yet?" flag.
 *
 * One at a time, deliberately. A column of three suggestions is a wall of text
 * on a phone and teaches nothing; the next single useful action does.
 */

export interface Hint {
  id: string;
  title: string;
  body: string;
  cta: { label: string; to: string };
}

export interface HintContext {
  /** Non-archived coffees in the library. */
  beans: number;
  ratings: number;
  /** True once at least one coffee came from a photo or a roaster URL. */
  usedAssistedCapture: boolean;
  /** Routes the user has actually opened. */
  visited: readonly string[];
  dismissed: readonly string[];
}

/**
 * Ordered by what the user needs next, not by how interesting the feature is.
 *
 * Rating comes first and alone, because every other feature is derived from
 * scores — recommending a coffee to someone who has rated nothing would mean
 * inventing a taste profile, and describing the feature before they have one is
 * how a tour ends up explaining an empty screen.
 */ function candidates(context: HintContext): Hint[] {
  const { beans, ratings, usedAssistedCapture, visited } = context;
  const hints: Hint[] = [];

  // An empty library already has an EmptyState with its own call to action;
  // a hint beside it would be the same sentence twice.
  if (beans === 0) return hints;

  // The hero on Home already tells an unrated library to rate something, and
  // repeating it in a card underneath teaches nothing. What the hero does not
  // say is where the finish line is, so that is the hint: a countdown to the
  // point where the rest of the app switches on.
  if (ratings < MIN_RATINGS_FOR_RECOMMENDATIONS) {
    const togo = MIN_RATINGS_FOR_RECOMMENDATIONS - ratings;
    hints.push({
      id: 'keep-rating',
      title: `${togo} more ${togo === 1 ? 'rating' : 'ratings'} and recommendations switch on`,
      body: `Your scores are the whole engine. “For you” and “Check” wait for ${MIN_RATINGS_FOR_RECOMMENDATIONS} of them before saying anything, so that what they say comes from your taste rather than a guess.`,
      cta: { label: ratings === 0 ? 'Rate a coffee' : 'Rate another coffee', to: '/beans' },
    });
  }

  if (ratings >= MIN_RATINGS_FOR_RECOMMENDATIONS && !visited.includes('/for-you')) {
    hints.push({
      id: 'for-you-ready',
      title: 'Recommendations are ready',
      body: 'You have rated enough coffees for “For you” to work out what you tend to like — and to show you which of your own ratings it is reasoning from.',
      cta: { label: 'See what fits your taste', to: '/for-you' },
    });
  }

  if (ratings >= MIN_RATINGS_FOR_RECOMMENDATIONS && !visited.includes('/predict')) {
    hints.push({
      id: 'try-check',
      title: 'Check a coffee before you buy it',
      body: '“Check” predicts how you would score a coffee you have never tried — paste a roaster link or describe the bag — and shows the ratings of your own it based that on.',
      cta: { label: 'Try a prediction', to: '/predict' },
    });
  }

  if (!usedAssistedCapture) {
    hints.push({
      id: 'try-assisted-capture',
      title: 'You do not have to type the bag out',
      body: 'Adding a coffee can read the label straight off a photo, or pull the details from a roaster’s product page. Typing it in by hand is only the fallback.',
      cta: { label: 'Add from a photo or link', to: '/add' },
    });
  }

  return hints;
}

/** The one hint to show, or `null` when the user is past all of them. */
export function nextHint(context: HintContext): Hint | null {
  return candidates(context).find((hint) => !context.dismissed.includes(hint.id)) ?? null;
}

/**
 * Everything the walkthrough explains, in the order it becomes relevant.
 *
 * Kept beside the hints rather than written out in the Settings component, so
 * the two cannot drift into describing the app differently. The walkthrough is
 * meant to be the same explanation, available on demand instead of only at the
 * moment it happens to become true — a hint the user dismissed in a hurry is
 * otherwise gone for good, which was the exact failure a modal tour has.
 */
export interface WalkthroughStep {
  title: string;
  body: string;
  to: string;
}

export const WALKTHROUGH: WalkthroughStep[] = [
  {
    title: 'Add a coffee',
    body: 'Photograph the bag and the label is read for you, paste a link to the roaster’s page, or type it in. However it arrives, missing details can be filled in from the web later.',
    to: '/add',
  },
  {
    title: 'Rate what you drink',
    body: `Score the cup out of 10 and note how you brewed it. This is the part everything else depends on — ${MIN_RATINGS_FOR_RECOMMENDATIONS} ratings is enough to switch the rest of the app on.`,
    to: '/beans',
  },
  {
    title: 'See what fits your taste',
    body: '“For you” works out the origins, processes and roast levels you score highest, finds coffees that match, and shows which of your ratings it reasoned from.',
    to: '/for-you',
  },
  {
    title: 'Check before you buy',
    body: '“Check” predicts your score for a coffee you have never tried, with its confidence and its working shown, so you can judge whether to trust it.',
    to: '/predict',
  },
  {
    title: 'Look at the patterns',
    body: 'Analytics charts what you actually drink and how you score it. Summary reads the same history back as a year in review.',
    to: '/analytics',
  },
  {
    title: 'Keep it on your phone',
    body: 'Add the app to your home screen and it runs offline — everything is stored on the device, and signing in only adds syncing between your own devices.',
    to: '/settings',
  },
];
