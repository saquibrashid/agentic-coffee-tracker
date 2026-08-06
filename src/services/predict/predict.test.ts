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
    schemaVersion: 1,
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
    const { beans, ratings } = history(8, 5, {
      origins: [{ country: 'Ethiopia' }],
      process: 'natural',
      roastLevel: 'light',
      tastingNotes: ['blueberry'],
      roaster: 'Onyx Coffee Lab',
    });
    // A few mediocre cups elsewhere so the baseline is not already 5.
    const { beans: others, ratings: otherRatings } = history(8, 2, {
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
    expect(result.score).toBeGreaterThan(4.2);
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.supporting.map((e) => e.kind)).toContain('origin');
    expect(result.detracting).toHaveLength(0);
  });

  it('warns off a coffee matching a disliked profile', () => {
    const { beans, ratings } = history(8, 5, {
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
    expect(result.score).toBeLessThan(2.5);
    expect(result.detracting.length).toBeGreaterThan(0);
  });

  it('stays unsure when there is no evidence, rather than guessing', () => {
    const { beans, ratings } = history(10, 5, { origins: [{ country: 'Ethiopia' }] });
    const index = buildIndex(beans, ratings);

    const result = predict({ roaster: 'Nobody', origins: [{ country: 'Peru' }] }, index);

    expect(result.verdict).toBe('unsure');
    expect(result.confidence).toBe(0);
    expect(result.unknowns).toEqual(expect.arrayContaining(['Nobody', 'Peru']));
    // With nothing to go on the estimate is exactly the user's own average.
    expect(result.score).toBe(5);
  });

  it('shrinks a single glowing data point toward the baseline', () => {
    const one = bean({ origins: [{ country: 'Panama' }] });
    const { beans, ratings } = history(9, 3, { origins: [{ country: 'Brazil' }] });

    const index = buildIndex([...beans, one], [...ratings, rating(one.id, 5)]);
    const result = predict({ origins: [{ country: 'Panama' }] }, index);

    // Baseline is 3.2; one 5-star cup must not produce a 5-star prediction.
    expect(result.score).toBeGreaterThan(index.baseline);
    expect(result.score).toBeLessThan(4);
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
    const liked = history(6, 5, { tastingNotes: notes, origins: [{ country: 'Kenya' }] });
    const disliked = history(6, 1, { origins: [{ country: 'Brazil' }] });

    const index = buildIndex(
      [...liked.beans, ...disliked.beans],
      [...liked.ratings, ...disliked.ratings],
    );
    const withNotes = predict({ origins: [{ country: 'Brazil' }], tastingNotes: notes }, index);
    const withoutNotes = predict({ origins: [{ country: 'Brazil' }] }, index);

    expect(withNotes.score).toBeGreaterThan(withoutNotes.score);
    expect(withNotes.score).toBeLessThan(3.5);
  });

  it('never returns a score outside the 1-5 scale', () => {
    const { beans, ratings } = history(20, 5, { origins: [{ country: 'Ethiopia' }] });
    const index = buildIndex(beans, ratings);
    const candidate: Candidate = { origins: [{ country: 'Ethiopia' }] };

    const result = predict(candidate, index);

    expect(result.score).toBeLessThanOrEqual(5);
    expect(result.score).toBeGreaterThanOrEqual(1);
  });

  it('is unsure on an empty library instead of throwing', () => {
    const result = predict({ roaster: 'Onyx' }, buildIndex([], []));

    expect(result.verdict).toBe('unsure');
    expect(result.score).toBe(3);
    expect(result.confidence).toBe(0);
  });
});

describe('explain', () => {
  it('cites the real numbers behind a match', () => {
    expect(
      explain({ kind: 'origin', label: 'Ethiopia', count: 7, averageScore: 4.57, delta: 0.4 }),
    ).toBe('Coffees from Ethiopia average 4.6/5 across 7 cups.');
    expect(
      explain({ kind: 'roaster', label: 'Onyx', count: 1, averageScore: 5, delta: 1 }),
    ).toBe('You have rated 1 cup from Onyx at 5.0/5.');
  });
});
