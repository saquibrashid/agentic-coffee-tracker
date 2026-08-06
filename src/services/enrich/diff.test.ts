import { describe, it, expect } from 'vitest';
import {
  applyProposals,
  buildProposals,
  defaultSelection,
  formatValue,
  type EnrichableField,
} from './diff';
import type { ParsedBean } from '@/services/ai';
import type { CoffeeBean } from '@/types';

function bean(overrides: Partial<CoffeeBean> = {}): CoffeeBean {
  return {
    id: 'b1',
    schemaVersion: 1,
    roaster: 'Unknown',
    name: 'Draft from photo',
    source: 'photo-ocr',
    isArchived: false,
    needsReview: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function parsed(overrides: Partial<ParsedBean> = {}): ParsedBean {
  return {
    roaster: 'Onyx Coffee Lab',
    name: 'Geometry',
    origins: [
      { country: 'Ethiopia', region: 'Guji', farm: null, producer: null, percentage: null },
    ],
    process: 'washed',
    roastLevel: 'light',
    tastingNotes: ['peach', 'jasmine'],
    roastDate: null,
    varietals: ['Heirloom'],
    elevationMeters: null,
    roasterDescription: 'A bright, floral coffee.',
    confidence: 0.9,
    ...overrides,
  };
}

const fields = (list: ReturnType<typeof buildProposals>) => list.map((p) => p.field);

describe('formatValue', () => {
  it('renders origins with their region', () => {
    expect(formatValue('origins', [{ country: 'Ethiopia', region: 'Guji' }])).toBe(
      'Ethiopia (Guji)',
    );
  });

  it('renders origins without a region', () => {
    expect(formatValue('origins', [{ country: 'Kenya' }])).toBe('Kenya');
  });

  it('joins arrays', () => {
    expect(formatValue('tastingNotes', ['peach', 'jasmine'])).toBe('peach, jasmine');
  });

  it('treats capture placeholders as empty', () => {
    expect(formatValue('roaster', 'Unknown')).toBeNull();
    expect(formatValue('name', 'Draft from photo')).toBeNull();
    expect(formatValue('tastingNotes', [])).toBeNull();
    expect(formatValue('roaster', '   ')).toBeNull();
  });
});

describe('buildProposals', () => {
  it('proposes every field the enrichment can fill on a placeholder bean', () => {
    const proposals = buildProposals(bean(), parsed());
    expect(fields(proposals)).toEqual([
      'roaster',
      'name',
      'origins',
      'process',
      'roastLevel',
      'varietals',
      'tastingNotes',
      'roasterDescription',
    ]);
  });

  it('does not flag placeholder values as conflicts', () => {
    // "Unknown" and "Draft from photo" are what the capture flow writes before
    // the AI runs; treating them as real data would make every bean a conflict.
    const proposals = buildProposals(bean(), parsed());
    expect(proposals.every((p) => !p.isConflict)).toBe(true);
  });

  it('flags a genuine overwrite as a conflict and shows both values', () => {
    const proposals = buildProposals(bean({ roaster: 'Blue Bottle' }), parsed());
    const roaster = proposals.find((p) => p.field === 'roaster');
    expect(roaster).toMatchObject({
      current: 'Blue Bottle',
      proposed: 'Onyx Coffee Lab',
      isConflict: true,
    });
  });

  it('omits fields where the proposal matches what is already there', () => {
    const proposals = buildProposals(
      bean({ roaster: 'Onyx Coffee Lab', tastingNotes: ['peach', 'jasmine'] }),
      parsed(),
    );
    expect(fields(proposals)).not.toContain('roaster');
    expect(fields(proposals)).not.toContain('tastingNotes');
  });

  it('omits fields the enrichment could not resolve', () => {
    const proposals = buildProposals(
      bean(),
      parsed({ process: null, varietals: [], roasterDescription: null }),
    );
    expect(fields(proposals)).not.toContain('process');
    expect(fields(proposals)).not.toContain('varietals');
    expect(fields(proposals)).not.toContain('roasterDescription');
  });

  it('never proposes purchase details a product page cannot know', () => {
    const proposals = buildProposals(bean(), parsed({ roastDate: '2026-05-01' }));
    expect(fields(proposals)).not.toContain('roastDate');
    expect(fields(proposals)).not.toContain('pricePaid');
  });

  it('returns nothing when the bean is already complete', () => {
    const complete = bean({
      roaster: 'Onyx Coffee Lab',
      name: 'Geometry',
      origins: [{ country: 'Ethiopia', region: 'Guji' }],
      process: 'washed',
      roastLevel: 'light',
      varietals: ['Heirloom'],
      tastingNotes: ['peach', 'jasmine'],
      roasterDescription: 'A bright, floral coffee.',
    });
    expect(buildProposals(complete, parsed())).toEqual([]);
  });
});

describe('defaultSelection', () => {
  it('pre-selects only the non-destructive fills', () => {
    const proposals = buildProposals(bean({ roaster: 'Blue Bottle' }), parsed());
    const selection = defaultSelection(proposals);
    // Accepting the defaults must never destroy a value the user already has.
    expect(selection.has('roaster')).toBe(false);
    expect(selection.has('tastingNotes')).toBe(true);
  });
});

describe('applyProposals', () => {
  const options = {
    sourceUrl: 'https://roaster.example/geometry',
    now: '2026-06-01T00:00:00.000Z',
  };

  it('writes only the fields the user accepted', () => {
    const selected = new Set<EnrichableField>(['tastingNotes', 'process']);
    const update = applyProposals(parsed(), selected, options);
    expect(update).toEqual({
      tastingNotes: ['peach', 'jasmine'],
      process: 'washed',
      sourceUrl: options.sourceUrl,
      needsReview: true,
      updatedAt: options.now,
    });
  });

  it('never writes an unselected field, even when enrichment resolved it', () => {
    const update = applyProposals(parsed(), new Set<EnrichableField>(['process']), options);
    expect(update).not.toHaveProperty('roaster');
    expect(update).not.toHaveProperty('name');
  });

  it('flags the bean for review and records where the data came from', () => {
    const update = applyProposals(parsed(), new Set<EnrichableField>(['roaster']), options);
    expect(update.needsReview).toBe(true);
    expect(update.sourceUrl).toBe(options.sourceUrl);
  });

  it('returns an empty update when nothing is selected, so no write happens', () => {
    // Importantly this must not stamp sourceUrl/needsReview on an untouched bean.
    expect(applyProposals(parsed(), new Set<EnrichableField>(), options)).toEqual({});
  });

  it('skips selected fields the enrichment could not resolve', () => {
    const update = applyProposals(
      parsed({ process: null }),
      new Set<EnrichableField>(['process']),
      options,
    );
    expect(update).toEqual({});
  });
});
