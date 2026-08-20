import { describe, expect, it } from 'vitest';
import {
  assembleGrounded,
  describeTaste,
  describesCandidate,
  dedupeCandidates,
  formatCandidates,
  isGroundedRecommendEnabled,
  type Candidate,
} from './groundedRecommend.js';
import type { PreferenceSummary } from './recommendSchema.js';

const anchorhead: Candidate = {
  url: 'https://anchorheadcoffee.com/products/be-good-edwin-norena',
  title: 'Be Good — Edwin Noreña Green Apple Co-Ferment',
  host: 'anchorheadcoffee.com',
};

const stumptown: Candidate = {
  url: 'https://stumptowncoffee.com/products/holler-mountain',
  title: 'Holler Mountain | Stumptown Coffee Roasters',
  host: 'stumptowncoffee.com',
};

function summary(overrides: Partial<PreferenceSummary> = {}): PreferenceSummary {
  return {
    favoriteOrigins: [{ value: 'ethiopia', count: 4, averageScore: 8.5 }],
    favoriteRoasters: [{ value: 'onyx', count: 3, averageScore: 8.8 }],
    favoriteProcesses: [{ value: 'washed', count: 5, averageScore: 8.1 }],
    favoriteRoastLevels: [{ value: 'light', count: 6, averageScore: 8.2 }],
    favoriteFlavors: [{ value: 'citrus', count: 4, averageScore: 8.6 }],
    favoriteBrewTypes: [],
    averageScore: 8,
    totalRatings: 9,
    ...overrides,
  };
}

function pick(overrides: Record<string, unknown> = {}) {
  return {
    candidate: 1,
    roaster: 'Anchorhead Coffee',
    coffeeName: 'Be Good Edwin Noreña Green Apple Co-Ferment',
    rationale: 'Bright and fruity, like the Ethiopians you rate highest.',
    basedOn: ['ethiopia', 'citrus'],
    origin: 'Colombia',
    roastLevel: 'light',
    process: 'co-ferment',
    flavorNotes: ['green apple'],
    ...overrides,
  };
}

describe('describeTaste', () => {
  it('describes the coffee, not the shelf it already owns', () => {
    const described = describeTaste(summary());
    expect(described).toContain('ethiopia');
    expect(described).toContain('citrus');
    // Searching for the user's favourite roaster returns their own cupboard.
    expect(described).not.toContain('onyx');
  });

  it('still says something searchable when the profile is bare', () => {
    const bare = describeTaste(
      summary({
        favoriteOrigins: [],
        favoriteFlavors: [],
        favoriteProcesses: [],
        favoriteRoastLevels: [],
      }),
    );
    expect(bare.length).toBeGreaterThan(0);
  });
});

describe('dedupeCandidates', () => {
  it('drops marketplaces, which are never the roaster', () => {
    const kept = dedupeCandidates([
      { url: 'https://www.amazon.com/dp/B01', title: 'Holler Mountain 12oz' },
      { url: stumptown.url, title: stumptown.title },
    ]);
    expect(kept.map((c) => c.host)).toEqual(['stumptowncoffee.com']);
  });

  it('treats the same page with tracking parameters as one coffee', () => {
    const kept = dedupeCandidates([
      { url: `${stumptown.url}?utm_source=x`, title: stumptown.title },
      { url: `${stumptown.url}/`, title: 'Holler Mountain' },
    ]);
    expect(kept).toHaveLength(1);
  });

  it('caps one roaster so a single catalog cannot fill every slot', () => {
    const kept = dedupeCandidates(
      [1, 2, 3, 4].map((n) => ({
        url: `https://onyxcoffeelab.com/products/coffee-${n}`,
        title: `Coffee ${n}`,
      })),
      { perHost: 2 },
    );
    expect(kept).toHaveLength(2);
  });

  it('ignores citations with no title, which cannot be validated later', () => {
    expect(dedupeCandidates([{ url: stumptown.url, title: '   ' }])).toEqual([]);
  });
});

describe('describesCandidate', () => {
  it('accepts names taken from the page, even with the roaster only in the domain', () => {
    expect(
      describesCandidate(
        'Anchorhead Coffee',
        'Be Good Edwin Noreña Green Apple Co-Ferment',
        anchorhead,
      ),
    ).toBe(true);
  });

  it('accepts a title that carries the roaster suffix', () => {
    expect(describesCandidate('Stumptown Coffee Roasters', 'Holler Mountain', stumptown)).toBe(
      true,
    );
  });

  it('rejects a coffee name the cited page says nothing about', () => {
    expect(describesCandidate('Stumptown Coffee Roasters', 'Hair Bender Espresso', stumptown)).toBe(
      false,
    );
  });

  it('rejects a roaster that does not own the page', () => {
    expect(describesCandidate('Blue Bottle Coffee', 'Holler Mountain', stumptown)).toBe(false);
  });

  it('rejects empty labels', () => {
    expect(describesCandidate('', 'Holler Mountain', stumptown)).toBe(false);
    expect(describesCandidate('Stumptown', '  ', stumptown)).toBe(false);
  });
});

describe('assembleGrounded', () => {
  const at = '2026-01-02T03:04:05.000Z';

  it('attaches the URL from the chosen candidate, not from the model', () => {
    const [first] = assembleGrounded({ picks: [pick()] }, [anchorhead, stumptown], at);
    expect(first?.product).toEqual({
      roaster: 'Anchorhead Coffee',
      name: 'Be Good Edwin Noreña Green Apple Co-Ferment',
      url: anchorhead.url,
      verifiedAt: at,
    });
  });

  it('drops a pick pointing at a candidate that was never offered', () => {
    expect(assembleGrounded({ picks: [pick({ candidate: 9 })] }, [anchorhead], at)).toEqual([]);
  });

  it('drops a pick whose names describe a different coffee', () => {
    const out = assembleGrounded(
      { picks: [pick({ coffeeName: 'Hair Bender Espresso', roaster: 'Stumptown' })] },
      [anchorhead],
      at,
    );
    expect(out).toEqual([]);
  });

  it('keeps the good picks when one is bad', () => {
    const out = assembleGrounded(
      {
        picks: [
          pick({ candidate: 42 }),
          pick({
            candidate: 2,
            roaster: 'Stumptown Coffee Roasters',
            coffeeName: 'Holler Mountain',
          }),
        ],
      },
      [anchorhead, stumptown],
      at,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.product?.url).toBe(stumptown.url);
  });

  it('refuses a suggestion with nothing to ground it in', () => {
    expect(assembleGrounded({ picks: [pick({ basedOn: [] })] }, [anchorhead], at)).toEqual([]);
    expect(assembleGrounded({ picks: [pick({ rationale: '  ' })] }, [anchorhead], at)).toEqual([]);
  });

  it('will not offer the same coffee twice', () => {
    const out = assembleGrounded({ picks: [pick(), pick()] }, [anchorhead, stumptown], at);
    expect(out).toHaveLength(1);
  });

  it('survives output that is not the shape it asked for', () => {
    expect(assembleGrounded(null, [anchorhead], at)).toEqual([]);
    expect(assembleGrounded({ picks: 'nope' }, [anchorhead], at)).toEqual([]);
    expect(assembleGrounded({ picks: ['nope'] }, [anchorhead], at)).toEqual([]);
    expect(assembleGrounded({ picks: [pick({ candidate: 1.5 })] }, [anchorhead], at)).toEqual([]);
  });
});

describe('formatCandidates', () => {
  it('numbers from one, because that is what the model is asked to return', () => {
    expect(formatCandidates([anchorhead, stumptown]).split('\n')[0]).toMatch(/^1\. Be Good/);
  });
});

describe('isGroundedRecommendEnabled', () => {
  it('is on unless explicitly switched off', () => {
    delete process.env['GROUNDED_RECOMMEND_ENABLED'];
    expect(isGroundedRecommendEnabled()).toBe(true);
    process.env['GROUNDED_RECOMMEND_ENABLED'] = 'false';
    expect(isGroundedRecommendEnabled()).toBe(false);
    delete process.env['GROUNDED_RECOMMEND_ENABLED'];
  });
});
