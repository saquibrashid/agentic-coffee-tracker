import type { RankedItem, UserPreferences } from '@/types';
export interface ProfileStrength {
  label: 'Developing' | 'Growing' | 'Well defined';
  percent: number;
  description: string;
  nextMilestone: number | null;
}

export interface TasteInsight {
  title: string;
  body: string;
}

interface Signal {
  category: string;
  item: RankedItem<string>;
}

function display(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getProfileStrength(totalRatings: number): ProfileStrength {
  if (totalRatings < 6) {
    return {
      label: 'Developing',
      percent: Math.min(42, Math.round((totalRatings / 6) * 42)),
      description: 'A few more ratings will separate early favorites from one-off great cups.',
      nextMilestone: 6,
    };
  }
  if (totalRatings < 12) {
    return {
      label: 'Growing',
      percent: 42 + Math.round(((totalRatings - 6) / 6) * 38),
      description: 'Your strongest preferences are emerging, with room for more contrast.',
      nextMilestone: 12,
    };
  }
  return {
    label: 'Well defined',
    percent: Math.min(100, 80 + Math.round(Math.min(totalRatings - 12, 20))),
    description: 'There is enough history to distinguish recurring preferences with confidence.',
    nextMilestone: null,
  };
}

export function buildTasteInsights(preferences: UserPreferences): TasteInsight[] {
  if (preferences.totalRatings === 0) return [];

  const insights: TasteInsight[] = [];
  const baseline = preferences.averageScore;
  const origin = preferences.favoriteOrigins[0];
  const flavor = preferences.favoriteFlavors[0];
  const roast = preferences.favoriteRoastLevels[0];
  const brew = preferences.favoriteBrewTypes[0];

  // A category's leader only belongs in a "signature" if it actually runs above
  // the user's own average. With few values in a category the top entry can
  // still be one they rate poorly, and naming that as their taste is exactly the
  // bug this sentence had (issue #199).
  //
  // The margin matters as much as the sign. A value that sits *on* the baseline
  // is not a lean — if every coffee someone has rated is a dark roast then dark
  // roast is their whole history, not their preference — and it also absorbs
  // floating-point noise from the shrinkage arithmetic.
  const LEAN_MARGIN = 0.05;
  const leads = (item: RankedItem<string> | undefined, phrase: (value: string) => string) =>
    item && item.weightedScore > baseline + LEAN_MARGIN ? phrase(display(item.value)) : null;

  const signature = [
    leads(origin, (v) => `${v} coffees`),
    leads(roast, (v) => `${v} roasts`),
    leads(flavor, (v) => `${v} notes`),
  ].filter(Boolean);
  if (signature.length >= 2) {
    insights.push({
      title: 'Your current signature',
      body: `Your profile leans toward ${signature.join(', ').replace(/, ([^,]*)$/, ' and $1')}. Each of those runs above your ${baseline.toFixed(1)} average. They are separate recurring signals, not necessarily one combination.`,
    });
  }

  const signals: Signal[] = [
    ...preferences.favoriteOrigins.map((item) => ({ category: 'origin', item })),
    ...preferences.favoriteRoasters.map((item) => ({ category: 'roaster', item })),
    ...preferences.favoriteFlavors.map((item) => ({ category: 'flavor note', item })),
    ...preferences.favoriteBrewTypes.map((item) => ({ category: 'brew method', item })),
  ];
  const strongest = [...signals].sort(
    (a, b) => b.item.count - a.item.count || b.item.averageScore - a.item.averageScore,
  )[0];
  if (strongest) {
    insights.push({
      title: 'Clearest signal',
      body: `${display(strongest.item.value)} is your best-supported ${strongest.category}: ${strongest.item.averageScore.toFixed(1)} average across ${strongest.item.count} ${strongest.item.count === 1 ? 'rating' : 'ratings'}.`,
    });
  }

  /**
   * The one finding that can change a purchase.
   *
   * Everything else here names a favourite, which mostly confirms what the user
   * already knows. "You keep buying this and keep not enjoying it" is the
   * statement worth reading, and the data for it already exists — it was simply
   * never surfaced, because every list is sorted best-first and truncated.
   *
   * Two ratings minimum: a single disappointing cup is a bad day, not a pattern.
   */
  const weakest = [...signals]
    .filter((s) => s.item.count >= 2 && s.item.weightedScore < baseline)
    .sort((a, b) => a.item.weightedScore - b.item.weightedScore)[0];
  if (weakest) {
    insights.push({
      title: 'Recurring disappointment',
      body: `${display(weakest.item.value)} is the ${weakest.category} that most often lets you down: ${weakest.item.averageScore.toFixed(1)} across ${weakest.item.count} ratings, against your ${baseline.toFixed(1)} average. Worth checking the label before you buy another.`,
    });
  }

  if (brew) {
    insights.push({
      title: 'At the brewer',
      body: `${display(brew.value)} currently leads your methods at ${brew.averageScore.toFixed(1)}. Compare it with another method on the same coffee to learn whether the brewer or bean is driving the score.`,
    });
  }
  const missing: string[] = [];
  if (preferences.favoriteProcesses.length === 0) missing.push('processing method');
  if (preferences.favoriteRoastLevels.length === 0) missing.push('roast level');
  if (preferences.favoriteOrigins.length === 0) missing.push('origin');
  if (missing.length > 0) {
    insights.push({
      title: 'A blind spot to fill',
      body: `More complete ${missing.join(' and ')} data would unlock another dimension of your profile.`,
    });
  } else if (preferences.favoriteOrigins.length >= 4 || preferences.favoriteBrewTypes.length >= 4) {
    insights.push({
      title: 'Explorer streak',
      body: 'Your history spans a broad mix of origins or brew methods, which makes comparisons more meaningful.',
    });
  }

  return insights.slice(0, 4);
}
