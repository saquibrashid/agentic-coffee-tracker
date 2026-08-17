import { describe, expect, it } from 'vitest';
import { buildIndex, explain, predict, type Candidate } from './predict';
import type { CoffeeBean, Rating } from '@/types';

let seq = 0;

function bean(overrides: Partial<CoffeeBean> = {}): CoffeeBean {
  seq += 1;
  return {
    id: `b${seq}`,
    schemaVersion: 1,
    roaster: 'Onyx Coffee Lab',
    name: `Coffee ${seq}`,
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function rating(beanId: string, score: number): Rating {
  seq += 1;
  return {
    id: `r${seq}`,
    schemaVersion: 2,
    beanId,
    score,
    brewType: 'latte',
    ratedAt: '2025-01-01T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

/** Builds a history of `count` identical coffees each rated `score`. */
function history(count: number, score: number, attrs: Partial<CoffeeBean>) {
  const beans: CoffeeBean[] = [];
  const ratings: Rating[] = [];
  for (let i = 0; i < count; i += 1) {
    const b = bean(attrs);
    beans.push(b);
    ratings.push(rating(b.id, score));
  }
  return { beans, ratings };
}

describe('buildIndex', () => {
  it('averages by attribute across the whole history', () => {
    const a = bean({ origins: [{ country: 'Ethiopia' }], process: 'natural' });
    const b = bean({ origins: [{ country: 'Ethiopia' }], process: 'washed' });

    const index = buildIndex([a, b], [rating(a.id, 5), rating(b.id, 3)]);

    expect(index.origins.get('ethiopia')?.count).toBe(2);
    expect(index.origins.get('ethiopia')?.averageScore).toBe(4);
    expect(index.processes.get('natural')?.averageScore).toBe(5);
    expect(index.baseline).toBe(4);
  });

  it('matches case- and whitespace-insensitively but keeps the original label', () => {
    const a = bean({ tastingNotes: ['Dark  Chocolate'] });

    const index = buildIndex([a], [rating(a.id, 5)]);

    expect(index.flavours.get('dark chocolate')?.label).toBe('Dark  Chocolate');
  });

  it('ignores an "unknown" process rather than treating it as a value', () => {
    const a = bean({ process: 'unknown', roastLevel: 'unknown' });

    const index = buildIndex([a], [rating(a.id, 5)]);

    expect(index.processes.size).toBe(0);
    expect(index.roastLevels.size).toBe(0);
  });

  it('counts a rating toward the baseline even if its coffee was deleted', () => {
    const index = buildIndex([], [rating('gone', 5), rating('gone', 3)]);

    expect(index.baseline).toBe(4);
    expect(index.totalRatings).toBe(2);
  });
});

describe('predict', () => {
  it('is enthusiastic about a coffee matching a well-liked profile', () => {
    const { beans, ratings } = history(8, 10, {
      origins: [{ country: 'Ethiopia' }],
      process: 'natural',
      roastLevel: 'light',
      tastingNotes: ['blueberry'],
      roaster: 'Onyx Coffee Lab',
    });
    // A few mediocre cups elsewhere so the baseline is not already 10.
    const { beans: others, ratings: otherRatings } = history(8, 4, {
      origins: [{ country: 'Brazil' }],
      process: 'washed',
      roastLevel: 'dark',
      roaster: 'Supermarket',
    });

    const index = buildIndex([...beans, ...others], [...ratings, ...otherRatings]);
    const result = predict(
      {
        roaster: 'Onyx Coffee Lab',
        origins: [{ country: 'Ethiopia' }],
        process: 'natural',
        roastLevel: 'light',
        tastingNotes: ['blueberry'],
      },
      index,
    );

    expect(result.verdict).toBe('love');
    expect(result.score).toBeGreaterThan(8.4);
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.supporting.map((e) => e.kind)).toContain('origin');
    expect(result.detracting).toHaveLength(0);
  });

  it('warns off a coffee matching a disliked profile', () => {
    const { beans, ratings } = history(8, 10, {
      origins: [{ country: 'Ethiopia' }],
      process: 'natural',
      roastLevel: 'light',
    });
    const { beans: others, ratings: otherRatings } = history(8, 1, {
      origins: [{ country: 'Brazil' }],
      process: 'washed',
      roastLevel: 'dark',
      roaster: 'Supermarket',
    });

    const index = buildIndex([...beans, ...others], [...ratings, ...otherRatings]);
    const result = predict(
      {
        roaster: 'Supermarket',
        origins: [{ country: 'Brazil' }],
        process: 'washed',
        roastLevel: 'dark',
      },
      index,
    );

    expect(result.verdict).toBe('avoid');
    expect(result.score).toBeLessThan(4);
    expect(result.detracting.length).toBeGreaterThan(0);
  });

  it('stays unsure when there is no evidence, rather than guessing', () => {
    const { beans, ratings } = history(10, 10, { origins: [{ country: 'Ethiopia' }] });
    const index = buildIndex(beans, ratings);

    const result = predict({ roaster: 'Nobody', origins: [{ country: 'Peru' }] }, index);

    expect(result.verdict).toBe('unsure');
    expect(result.confidence).toBe(0);
    expect(result.unknowns).toEqual(expect.arrayContaining(['Nobody', 'Peru']));
    // With nothing to go on the estimate is exactly the user's own average.
    expect(result.score).toBe(10);
  });

  it('shrinks a single glowing data point toward the baseline', () => {
    const one = bean({ origins: [{ country: 'Panama' }] });
    const { beans, ratings } = history(9, 6, { origins: [{ country: 'Brazil' }] });

    const index = buildIndex([...beans, one], [...ratings, rating(one.id, 10)]);
    const result = predict({ origins: [{ country: 'Panama' }] }, index);

    // Baseline is 6.4; one top-marks cup must not produce a top-marks prediction.
    expect(result.score).toBeGreaterThan(index.baseline);
    expect(result.score).toBeLessThan(8);
    expect(result.confidence).toBeLessThan(0.35);
  });

  it('reports which attributes the candidate never supplied', () => {
    const { beans, ratings } = history(5, 4, { origins: [{ country: 'Kenya' }] });
    const index = buildIndex(beans, ratings);

    const result = predict({ origins: [{ country: 'Kenya' }] }, index);

    expect(result.missing).toEqual(
      expect.arrayContaining(['roaster', 'process', 'roast level', 'tasting notes']),
    );
    expect(result.missing).not.toContain('origin');
  });

  it('caps how far tasting notes can swing the answer', () => {
    // Twelve strongly-liked notes must not outweigh a strongly-disliked origin.
    const notes = Array.from({ length: 12 }, (_, i) => `note-${i}`);
    const liked = history(6, 10, { tastingNotes: notes, origins: [{ country: 'Kenya' }] });
    const disliked = history(6, 1, { origins: [{ country: 'Brazil' }] });

    const index = buildIndex(
      [...liked.beans, ...disliked.beans],
      [...liked.ratings, ...disliked.ratings],
    );
    const withNotes = predict({ origins: [{ country: 'Brazil' }], tastingNotes: notes }, index);
    const withoutNotes = predict({ origins: [{ country: 'Brazil' }] }, index);

    expect(withNotes.score).toBeGreaterThan(withoutNotes.score);
    expect(withNotes.score).toBeLessThan(7);
  });

  it('never returns a score outside the 1-10 scale', () => {
    const { beans, ratings } = history(20, 10, { origins: [{ country: 'Ethiopia' }] });
    const index = buildIndex(beans, ratings);
    const candidate: Candidate = { origins: [{ country: 'Ethiopia' }] };

    const result = predict(candidate, index);

    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.score).toBeGreaterThanOrEqual(1);
  });

  it('is unsure on an empty library instead of throwing', () => {
    const result = predict({ roaster: 'Onyx' }, buildIndex([], []));

    expect(result.verdict).toBe('unsure');
    expect(result.score).toBe(5.5);
    expect(result.confidence).toBe(0);
  });

  it('tells two coffees apart instead of rounding them together', () => {
    // #200: the user compared a dark roast and a light roast from the same
    // roaster and origin and got the same 7.5 for both. The estimate was being
    // snapped onto the half-steps a rating form offers, which is a resolution
    // the arithmetic does not have to give up.
    const liked = history(3, 8.3, {
      origins: [{ country: 'Ethiopia' }],
      process: 'washed',
      roastLevel: 'light',
      tastingNotes: ['molasses'],
    });
    const meh = history(8, 6.5, {
      origins: [{ country: 'Colombia' }],
      process: 'washed',
      roastLevel: 'medium',
      tastingNotes: ['dark chocolate'],
    });
    const index = buildIndex([...liked.beans, ...meh.beans], [...liked.ratings, ...meh.ratings]);

    const dark = predict(
      {
        roaster: 'Onyx Coffee Lab',
        origins: [{ country: 'Ethiopia' }],
        process: 'washed',
        roastLevel: 'dark',
        tastingNotes: ['dark chocolate'],
      },
      index,
    );
    const light = predict(
      {
        roaster: 'Onyx Coffee Lab',
        origins: [{ country: 'Ethiopia' }],
        process: 'washed',
        roastLevel: 'light',
        tastingNotes: ['molasses'],
      },
      index,
    );

    expect(light.score).toBeGreaterThan(dark.score);
  });

  it('does not let an attribute shared by everything drown out the rest', () => {
    // Every coffee is washed, so "washed" averages exactly the baseline and can
    // distinguish nothing — yet by sheer count it used to carry the largest
    // single weight of any attribute and pull every verdict back to the middle.
    const loved = history(4, 10, { origins: [{ country: 'Ethiopia' }], process: 'washed' });
    const hated = history(12, 5, { origins: [{ country: 'Brazil' }], process: 'washed' });
    const index = buildIndex(
      [...loved.beans, ...hated.beans],
      [...loved.ratings, ...hated.ratings],
    );

    const withProcess = predict({ origins: [{ country: 'Ethiopia' }], process: 'washed' }, index);
    const withoutProcess = predict({ origins: [{ country: 'Ethiopia' }] }, index);

    // Naming a process the user drinks in every single cup tells us nothing new,
    // so it should barely move the estimate. Before, it dragged it most of the
    // way from Ethiopia's 10 back toward the 6.25 baseline.
    expect(Math.abs(withProcess.score - withoutProcess.score)).toBeLessThan(0.5);
    expect(withProcess.score).toBeGreaterThan(index.baseline + 1);
  });

  it('treats roast level as a scale, not as unrelated labels', () => {
    // A candidate roast the user has never rated used to count as no evidence at
    // all, even with plenty of history one step along the scale.
    const dislikedDark = history(6, 3, { roastLevel: 'medium-dark' });
    const likedLight = history(6, 9, { roastLevel: 'light' });
    const index = buildIndex(
      [...dislikedDark.beans, ...likedLight.beans],
      [...dislikedDark.ratings, ...likedLight.ratings],
    );

    const result = predict({ roastLevel: 'dark' }, index);
    const roast = [...result.supporting, ...result.detracting].find((e) => e.kind === 'roastLevel');

    expect(roast?.label).toBe('medium-dark');
    expect(roast?.approximate).toBe(true);
    expect(result.score).toBeLessThan(index.baseline);
    // The value itself is still not one the user has rated.
    expect(result.unknowns).not.toContain('dark');
  });

  it('is less confident about a coffee it barely recognises', () => {
    const { beans, ratings } = history(12, 8, {
      origins: [{ country: 'Ethiopia' }],
      process: 'washed',
      roastLevel: 'light',
      tastingNotes: ['jasmine'],
      roaster: 'Onyx Coffee Lab',
    });
    const index = buildIndex(beans, ratings);

    const wellKnown = predict(
      {
        roaster: 'Onyx Coffee Lab',
        origins: [{ country: 'Ethiopia' }],
        process: 'washed',
        roastLevel: 'light',
        tastingNotes: ['jasmine'],
      },
      index,
    );
    const barelyKnown = predict({ origins: [{ country: 'Ethiopia' }] }, index);

    // Both rest on attributes averaging 8, so the scores agree; only the amount
    // of the coffee that was actually recognised differs.
    expect(barelyKnown.confidence).toBeLessThan(wellKnown.confidence / 2);
  });
});

describe('explain', () => {
  it('cites the real numbers behind a match', () => {
    expect(
      explain({ kind: 'origin', label: 'Ethiopia', count: 7, averageScore: 4.57, delta: 0.4 }),
    ).toBe('Coffees from Ethiopia average 4.6/10 across 7 ratings.');
    expect(explain({ kind: 'roaster', label: 'Onyx', count: 1, averageScore: 10, delta: 1 })).toBe(
      'You have 1 rating from Onyx averaging 10.0/10.',
    );
  });

  it('counts ratings rather than cups', () => {
    // #202: one bag rated twice is two ratings however many cups came out of
    // it, so "cups" was claiming a drinking history the app never recorded.
    const said = explain({
      kind: 'flavour',
      label: 'chocolate',
      count: 2,
      averageScore: 9,
      delta: 2,
    });

    expect(said).toContain('2 ratings');
    expect(said).not.toContain('cup');
  });

  it('does not claim the user has rated a roast level they have not', () => {
    expect(
      explain({
        kind: 'roastLevel',
        label: 'medium-dark',
        count: 4,
        averageScore: 6,
        delta: -1,
        approximate: true,
      }),
    ).toBe(
      'You have not rated this roast level, but the nearest you have — medium-dark — averages 6.0/10 across 4 ratings.',
    );
  });
});
