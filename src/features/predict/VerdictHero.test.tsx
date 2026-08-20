import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Prediction } from '@/services/predict/predict';
import { VerdictHero } from './VerdictHero';

/**
 * The hero's job is to be loud without being misleading, so these test the two
 * ways it could mislead: implying more certainty than there is, and showing a
 * score whose picture disagrees with its own verdict.
 */
function prediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    score: 7.3,
    confidence: 0.44,
    baseline: 7,
    verdict: 'like',
    headline: 'Good odds you will enjoy this.',
    supporting: [],
    detracting: [],
    unknowns: [],
    missing: [],
    ...overrides,
  };
}

describe('VerdictHero', () => {
  it('draws the score on a scale and says where the user normally lands', () => {
    render(<VerdictHero prediction={prediction()} />);

    const meter = screen.getByRole('meter', { name: 'Predicted score' });
    expect(meter).toHaveAttribute('aria-valuenow', '7.3');
    expect(meter).toHaveAttribute('aria-valuemin', '1');
    expect(meter).toHaveAttribute('aria-valuemax', '10');
    expect(screen.getByTestId('prediction-baseline')).toHaveTextContent(
      'Your average is 7 — this lands above it.',
    );
  });

  it('calls a score below the usual what it is, however respectable it looks', () => {
    // 7.3 out of 10 sounds fine in the abstract; for someone who averages 8.8 it
    // is a warning, and the hero must not let the digits imply otherwise.
    render(<VerdictHero prediction={prediction({ baseline: 8.8, verdict: 'avoid' })} />);

    expect(screen.getByTestId('prediction-baseline')).toHaveTextContent(
      'Your average is 8.8 — this lands below it.',
    );
  });

  it('keeps the score and confidence as separate readings', () => {
    render(<VerdictHero prediction={prediction()} />);

    // Two meters, not one: a long score bar must never be readable as "we are
    // sure". The confidence one carries its own, much lower, value.
    expect(screen.getByRole('meter', { name: 'Prediction confidence' })).toHaveAttribute(
      'aria-valuenow',
      '44',
    );
    expect(screen.getAllByRole('meter')).toHaveLength(2);
  });

  it('still marks the average when the score sits exactly on it', () => {
    render(<VerdictHero prediction={prediction({ score: 7, baseline: 7 })} />);

    expect(screen.getByTestId('prediction-baseline')).toHaveTextContent(
      'Your average is 7 — this lands above it.',
    );
  });
});
