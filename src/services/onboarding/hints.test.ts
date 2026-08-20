import { describe, expect, it } from 'vitest';

import { nextHint, WALKTHROUGH, type HintContext } from './hints';
import { MIN_RATINGS_FOR_RECOMMENDATIONS } from '@/services/preferences/compute';

function context(overrides: Partial<HintContext> = {}): HintContext {
  return {
    beans: 1,
    ratings: 0,
    usedAssistedCapture: true,
    visited: [],
    dismissed: [],
    ...overrides,
  };
}

describe('nextHint', () => {
  it('says nothing on an empty library, where the empty state already speaks', () => {
    expect(nextHint(context({ beans: 0, usedAssistedCapture: false }))).toBeNull();
  });

  it('counts down to the threshold instead of repeating the hero’s “rate something”', () => {
    const first = nextHint(context({ ratings: 0 }));
    expect(first?.id).toBe('keep-rating');
    expect(first?.title).toContain(`${MIN_RATINGS_FOR_RECOMMENDATIONS} more ratings`);

    const nearly = nextHint(context({ ratings: MIN_RATINGS_FOR_RECOMMENDATIONS - 1 }));
    expect(nearly?.title).toContain('1 more rating');
  });

  it('announces recommendations only once they will work', () => {
    expect(nextHint(context({ ratings: MIN_RATINGS_FOR_RECOMMENDATIONS }))?.id).toBe(
      'for-you-ready',
    );
  });

  it('moves on to prediction once the user has seen recommendations', () => {
    const hint = nextHint(
      context({ ratings: MIN_RATINGS_FOR_RECOMMENDATIONS, visited: ['/for-you'] }),
    );
    expect(hint?.id).toBe('try-check');
  });

  it('mentions assisted capture only to someone who has only ever typed', () => {
    const seen = { ratings: 5, visited: ['/for-you', '/predict'] };
    expect(nextHint(context({ ...seen, usedAssistedCapture: false }))?.id).toBe(
      'try-assisted-capture',
    );
    expect(nextHint(context({ ...seen, usedAssistedCapture: true }))).toBeNull();
  });

  // The point of gating on data rather than a "have I shown this?" flag: an
  // established user is past every hint the first time the app loads, including
  // on a device that has never seen it before.
  it('shows a returning user with a real history nothing at all', () => {
    expect(
      nextHint({
        beans: 20,
        ratings: 40,
        usedAssistedCapture: true,
        visited: ['/', '/for-you', '/predict'],
        dismissed: [],
      }),
    ).toBeNull();
  });

  it('moves to the next hint rather than falling silent when one is dismissed', () => {
    const state = context({
      ratings: MIN_RATINGS_FOR_RECOMMENDATIONS,
      dismissed: ['for-you-ready'],
    });
    expect(nextHint(state)?.id).toBe('try-check');
  });

  it('shows one hint at a time', () => {
    const hint = nextHint(context({ ratings: 0, usedAssistedCapture: false }));
    expect(hint?.id).toBe('keep-rating');
  });
});

describe('WALKTHROUGH', () => {
  it('points every step at a route the app serves', () => {
    const routes = ['/add', '/beans', '/for-you', '/predict', '/analytics', '/settings'];
    for (const step of WALKTHROUGH) {
      expect(routes).toContain(step.to);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });

  it('covers the features the hints point at, so the two cannot disagree', () => {
    const destinations = WALKTHROUGH.map((step) => step.to);
    expect(destinations).toContain('/for-you');
    expect(destinations).toContain('/predict');
  });
});
