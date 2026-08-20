import { describe, expect, it } from 'vitest';

import { describeTally, emptyTally, tallyLookups, type LookupTally } from './lookupOutcome';
import type { CoffeeBean, LookupOutcome } from '@/types';

function bean(id: string, lastLookupAt?: string, lastLookupOutcome?: LookupOutcome): CoffeeBean {
  return {
    id,
    schemaVersion: 1,
    roaster: 'Roaster',
    name: id,
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    // Spread rather than assigned: `exactOptionalPropertyTypes` treats an
    // explicit `undefined` as a different thing from an absent field, and a
    // coffee that has never been looked up has no key at all.
    ...(lastLookupAt === undefined ? {} : { lastLookupAt }),
    ...(lastLookupOutcome === undefined ? {} : { lastLookupOutcome }),
  };
}

const RUN = '2026-02-01T00:00:00.000Z';

describe('tallyLookups', () => {
  it('counts only outcomes from the run in question', () => {
    const beans = [
      bean('a', '2026-01-31T23:59:59.000Z', 'filled'),
      bean('b', RUN, 'filled'),
      bean('c', '2026-02-01T00:00:05.000Z', 'not-found'),
    ];

    const tally = tallyLookups(beans, RUN, 3);

    expect(tally.filled).toBe(1);
    expect(tally.notFound).toBe(1);
  });

  /**
   * Without a run marker every historical outcome would be reported as if it
   * had just happened, which is a worse lie than the silence it replaced.
   */
  it('reports nothing when no run has been recorded', () => {
    const beans = [bean('a', RUN, 'filled')];

    expect(tallyLookups(beans, null, 0)).toEqual(emptyTally());
  });

  it('treats coffees queued but not yet reported as pending', () => {
    const beans = [bean('a', RUN, 'filled'), bean('b')];

    expect(tallyLookups(beans, RUN, 4).pending).toBe(3);
  });

  /** A cancelled task must not push the count negative. */
  it('never reports negative pending work', () => {
    const beans = [bean('a', RUN, 'filled'), bean('b', RUN, 'failed')];

    expect(tallyLookups(beans, RUN, 1).pending).toBe(0);
  });

  it('ignores a coffee that has an outcome but no timestamp', () => {
    const beans = [bean('a', undefined, 'filled')];

    expect(tallyLookups(beans, RUN, 1).filled).toBe(0);
  });
});

function tally(partial: Partial<LookupTally>): LookupTally {
  return { ...emptyTally(), ...partial };
}

describe('describeTally', () => {
  it('says nothing when no run has happened', () => {
    expect(describeTally(emptyTally())).toBeNull();
  });

  /**
   * The defect in #246: a run that changed nothing looked exactly like a button
   * that was never pressed. "Found nothing" has to be said out loud.
   */
  it('reports a run that found nothing', () => {
    const message = describeTally(tally({ nothingNew: 4 }));

    expect(message).toContain('found nothing new for 4 coffees');
  });

  it('tells the user that a missing product page will not retry itself', () => {
    const message = describeTally(tally({ notFound: 2 }));

    expect(message).toContain('no product page for 2 coffees');
    expect(message).toContain('editing the name');
  });

  it('joins several outcomes into one sentence', () => {
    const message = describeTally(tally({ filled: 1, nothingNew: 2, failed: 1 }));

    expect(message).toBe(
      'The last run filled in 1 coffee, found nothing new for 2 coffees and failed on 1 coffee.',
    );
  });

  it('mentions work still in flight', () => {
    expect(describeTally(tally({ pending: 3 }))).toBe('3 lookups are still running.');
    expect(describeTally(tally({ filled: 1, pending: 1 }))).toContain('1 lookup is still running.');
  });
});
