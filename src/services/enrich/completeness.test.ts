import { describe, expect, it } from 'vitest';

import { beanNeedsEnrichment, describeMissing, missingBadgeLabel } from './completeness';
import type { CoffeeBean } from '@/types';

function bean(overrides: Partial<CoffeeBean> = {}): CoffeeBean {
  return {
    id: 'b1',
    schemaVersion: 1,
    roaster: 'Roaster',
    name: 'Coffee',
    origins: [{ country: 'Ethiopia' }],
    process: 'washed',
    roastLevel: 'light',
    tastingNotes: ['jasmine'],
    photoId: 'p1',
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * `exactOptionalPropertyTypes` rejects `{ photoId: undefined }`, and these
 * tests are entirely about fields being genuinely absent rather than present
 * and empty — so they have to be removed, not overwritten.
 */
function without(source: CoffeeBean, ...keys: (keyof CoffeeBean)[]): CoffeeBean {
  const copy = { ...source };
  for (const key of keys) delete copy[key];
  return copy;
}

describe('describeMissing', () => {
  it('says nothing about a complete coffee', () => {
    expect(describeMissing(bean())).toEqual([]);
    expect(beanNeedsEnrichment(bean())).toBe(false);
  });

  /**
   * The badge has to name the gap, not just flag one: "missing photo" and
   * "missing origin" call for completely different actions (#246).
   */
  it('names each missing core field in user words', () => {
    const missing = describeMissing(
      without(bean({ origins: [], roastLevel: 'unknown' }), 'tastingNotes'),
    );

    expect(missing).toEqual(['origin', 'roast level', 'tasting notes']);
  });

  it('counts a missing photo', () => {
    expect(describeMissing(without(bean(), 'photoId'))).toEqual(['photo']);
  });

  /**
   * `unknown` is the schema's "not established", so a coffee carrying it is
   * incomplete however filled-in it looks.
   */
  it('treats unknown as missing', () => {
    expect(beanNeedsEnrichment(bean({ process: 'unknown' }))).toBe(true);
  });

  /**
   * Varietals and elevation are enrichable but must never make a coffee look
   * incomplete on its own -- no spreadsheet carries them, so every imported
   * coffee would wear the badge forever.
   */
  it('ignores fields that are filled opportunistically', () => {
    expect(describeMissing(without(bean({ varietals: [] }), 'elevationMeters'))).toEqual([]);
  });
});

describe('missingBadgeLabel', () => {
  it('says nothing for a complete coffee', () => {
    expect(missingBadgeLabel(bean())).toBeNull();
  });

  it('names the gap when there is one', () => {
    expect(missingBadgeLabel(without(bean(), 'photoId'))).toBe('Missing photo');
  });

  it('names both gaps when there are two', () => {
    expect(missingBadgeLabel(without(bean(), 'photoId', 'process'))).toBe(
      'Missing process and photo',
    );
  });

  /**
   * A bulk-imported row is missing everything, and the joined list was longer
   * than the card is wide -- it clipped, which told the user less than a count
   * does.
   */
  it('falls back to a count once the list would overflow the card', () => {
    const bare = without(bean(), 'origins', 'process', 'roastLevel', 'tastingNotes', 'photoId');

    expect(missingBadgeLabel(bare)).toBe('Missing 5 details');
  });
});
