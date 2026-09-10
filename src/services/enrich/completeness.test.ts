import { describe, expect, it } from 'vitest';

import {
  beanNeedsEnrichment,
  describeMissing,
  isFieldMissing,
  isFieldOutstanding,
  isFieldUnpublished,
  missingBadgeLabel,
  missingFields,
  unpublishedAfterLookup,
} from './completeness';
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

/**
 * A field the roaster's page never carried (#309).
 *
 * The Stumptown case: Holler Mountain and Hair Bender are blends, their pages
 * state no process at all, and the coffee therefore badged "Missing process"
 * on every render and was re-queued by every relookup run — a chore with no
 * possible end. These assert the field stays *missing* while ceasing to be
 * *outstanding*, because the two are different questions.
 */
describe('fields a lookup has already drawn a blank on', () => {
  const blend = () => without(bean({ unpublishedFields: ['process'] }), 'process');

  it('still reports the field as missing', () => {
    expect(isFieldMissing(blend(), 'process')).toBe(true);
    expect(missingFields(blend())).toContain('process');
  });

  it('stops counting it as outstanding, so the nagging ends', () => {
    expect(isFieldOutstanding(blend(), 'process')).toBe(false);
    expect(isFieldUnpublished(blend(), 'process')).toBe(true);
    expect(describeMissing(blend())).toEqual([]);
    expect(missingBadgeLabel(blend())).toBeNull();
    expect(beanNeedsEnrichment(blend())).toBe(false);
  });

  it('does not exempt a field nobody has looked for', () => {
    const other = without(bean({ unpublishedFields: ['process'] }), 'process', 'roastLevel');
    expect(isFieldOutstanding(other, 'roastLevel')).toBe(true);
    expect(describeMissing(other)).toEqual(['roast level']);
    expect(beanNeedsEnrichment(other)).toBe(true);
  });

  it('still asks for a photo, which is never unpublishable', () => {
    const noPhoto = without(bean({ unpublishedFields: ['process'] }), 'process', 'photoId');
    expect(beanNeedsEnrichment(noPhoto)).toBe(true);
    expect(describeMissing(noPhoto)).toEqual(['photo']);
  });

  it('reports what a page failed to supply, for recording after a lookup', () => {
    expect(unpublishedAfterLookup(without(bean(), 'process'))).toEqual(['process']);
    expect(unpublishedAfterLookup(bean())).toEqual([]);
  });
});
