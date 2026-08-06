import { describe, expect, it } from 'vitest';
import type { CoffeeBean, Rating } from '@/types';
import {
  CSV_TEMPLATE,
  ImportFormatError,
  beanKey,
  parseBrewType,
  parseDate,
  parseScore,
  planCsvImport,
  type ExistingData,
} from './ratingsImport';

const EMPTY: ExistingData = { beans: [], ratings: [] };

function bean(overrides: Partial<CoffeeBean> & Pick<CoffeeBean, 'id' | 'roaster' | 'name'>): CoffeeBean {
  return {
    schemaVersion: 1,
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function rating(overrides: Partial<Rating> & Pick<Rating, 'id' | 'beanId'>): Rating {
  return {
    schemaVersion: 1,
    score: 4,
    brewType: 'espresso',
    ratedAt: '2025-03-14T12:00:00.000Z',
    createdAt: '2025-03-14T12:00:00.000Z',
    updatedAt: '2025-03-14T12:00:00.000Z',
    ...overrides,
  };
}

const HEADER = 'roaster,coffee,score,brew,date,notes';

describe('parseScore', () => {
  it('reads plain numbers', () => {
    expect(parseScore('4')).toBe(4);
  });

  it('rescales an out-of-N score onto 1-5', () => {
    expect(parseScore('8/10')).toBe(4);
    expect(parseScore('4/5')).toBe(4);
  });

  it('counts filled stars', () => {
    expect(parseScore('★★★★☆')).toBe(4);
  });

  it('rounds decimals', () => {
    expect(parseScore('4.5')).toBe(5);
    expect(parseScore('3.2')).toBe(3);
  });

  it('returns null when there is no number at all', () => {
    expect(parseScore('great')).toBeNull();
    expect(parseScore('')).toBeNull();
  });
});

describe('parseBrewType', () => {
  it('maps everyday names onto the stored enum', () => {
    expect(parseBrewType('pourover')).toBe('pour-over');
    expect(parseBrewType('V60')).toBe('pour-over');
    expect(parseBrewType('French Press')).toBe('french-press');
    expect(parseBrewType('cold brew')).toBe('cold-brew');
  });

  it('accepts the canonical spelling', () => {
    expect(parseBrewType('espresso')).toBe('espresso');
  });

  it('returns null for something unrecognised', () => {
    expect(parseBrewType('turkish')).toBeNull();
  });
});

describe('parseDate', () => {
  it('reads ISO dates without drifting a day', () => {
    // Anchored at UTC noon, so the calendar date survives any local offset.
    expect(parseDate('2025-03-14')?.slice(0, 10)).toBe('2025-03-14');
  });

  it('reads US slash dates', () => {
    expect(parseDate('3/14/2025')?.slice(0, 10)).toBe('2025-03-14');
    expect(parseDate('3/14/25')?.slice(0, 10)).toBe('2025-03-14');
  });

  it('returns null for nonsense', () => {
    expect(parseDate('sometime last spring')).toBeNull();
  });
});

describe('planCsvImport', () => {
  it('creates one bean per roaster+coffee and a rating per row', () => {
    const csv = [
      HEADER,
      'Onyx,Southern Weather,4,espresso,2025-03-14,',
      'Onyx,Southern Weather,5,pour-over,2025-03-15,',
      'Anchorhead,Bali Kintamani,5,espresso,2025-03-16,',
    ].join('\n');

    const plan = planCsvImport(csv, EMPTY);

    expect(plan.totalRows).toBe(3);
    expect(plan.newBeans).toHaveLength(2);
    expect(plan.newRatings).toHaveLength(3);
    expect(plan.errors).toHaveLength(0);
  });

  it('attaches rows to a coffee that already exists rather than duplicating it', () => {
    const existing: ExistingData = {
      beans: [bean({ id: 'b1', roaster: 'Onyx', name: 'Southern Weather' })],
      ratings: [],
    };
    // Different case and spacing must still match, or every import would fork
    // the library into near-identical coffees.
    const csv = [HEADER, '  onyx ,SOUTHERN   WEATHER,4,espresso,2025-03-14,'].join('\n');

    const plan = planCsvImport(csv, existing);

    expect(plan.newBeans).toHaveLength(0);
    expect(plan.matchedBeanCount).toBe(1);
    expect(plan.newRatings[0]?.beanId).toBe('b1');
  });

  it('skips a rating that is already stored so re-importing is a no-op', () => {
    const existing: ExistingData = {
      beans: [bean({ id: 'b1', roaster: 'Onyx', name: 'Southern Weather' })],
      ratings: [rating({ id: 'r1', beanId: 'b1', score: 4, brewType: 'espresso' })],
    };
    const csv = [HEADER, 'Onyx,Southern Weather,4,espresso,2025-03-14,'].join('\n');

    const plan = planCsvImport(csv, existing);

    expect(plan.newRatings).toHaveLength(0);
    expect(plan.duplicates).toHaveLength(1);
  });

  it('de-duplicates repeated rows within a single file', () => {
    const csv = [
      HEADER,
      'Onyx,Southern Weather,4,espresso,2025-03-14,',
      'Onyx,Southern Weather,4,espresso,2025-03-14,',
    ].join('\n');

    const plan = planCsvImport(csv, EMPTY);

    expect(plan.newRatings).toHaveLength(1);
    expect(plan.duplicates).toHaveLength(1);
  });

  it('reports bad rows by line number and still imports the good ones', () => {
    const csv = [
      HEADER,
      'Onyx,Southern Weather,4,espresso,2025-03-14,',
      ',No Roaster,4,espresso,2025-03-14,',
      'Onyx,Unreadable Score,lovely,espresso,2025-03-14,',
      'Onyx,Bad Date,4,espresso,last tuesday,',
      'Onyx,Out Of Range,9,espresso,2025-03-14,',
    ].join('\n');

    const plan = planCsvImport(csv, EMPTY);

    expect(plan.newRatings).toHaveLength(1);
    expect(plan.errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
  });

  it('does not create a coffee for a row that failed', () => {
    const csv = [HEADER, 'Onyx,Unreadable,lovely,espresso,2025-03-14,'].join('\n');

    const plan = planCsvImport(csv, EMPTY);

    expect(plan.newBeans).toHaveLength(0);
    expect(plan.newRatings).toHaveLength(0);
  });

  it('accepts alternative column names', () => {
    const csv = ['Brand,Bean Name,Stars,Brew Method,Date Tried', 'Onyx,Geometry,5,V60,2025-03-14'].join(
      '\n',
    );

    const plan = planCsvImport(csv, EMPTY);

    expect(plan.errors).toHaveLength(0);
    expect(plan.newRatings[0]?.brewType).toBe('pour-over');
    expect(plan.newBeans[0]?.name).toBe('Geometry');
  });

  it('imports bean metadata when the columns are there', () => {
    const csv = [
      'roaster,coffee,score,roast,process,origin,tasting notes',
      'Onyx,Geometry,5,medium-light,washed,"Colombia; Ethiopia","chocolate; citrus"',
    ].join('\n');

    const plan = planCsvImport(csv, EMPTY);
    const created = plan.newBeans[0];

    expect(created?.roastLevel).toBe('medium-light');
    expect(created?.process).toBe('washed');
    expect(created?.origins?.map((o) => o.country)).toEqual(['Colombia', 'Ethiopia']);
    expect(created?.tastingNotes).toEqual(['chocolate', 'citrus']);
  });

  it('falls back to "other" for an unknown brew and says so', () => {
    const csv = [HEADER, 'Onyx,Geometry,5,turkish,2025-03-14,'].join('\n');

    const plan = planCsvImport(csv, EMPTY);

    expect(plan.newRatings[0]?.brewType).toBe('other');
    expect(plan.warnings).toHaveLength(1);
  });

  it('defaults a missing date to now and warns', () => {
    const csv = [HEADER, 'Onyx,Geometry,5,espresso,,'].join('\n');

    const plan = planCsvImport(csv, EMPTY);

    expect(plan.newRatings).toHaveLength(1);
    expect(plan.warnings[0]?.message).toMatch(/no date/i);
  });

  it('omits notes entirely rather than storing an empty string', () => {
    const csv = [HEADER, 'Onyx,Geometry,5,espresso,2025-03-14,'].join('\n');

    const plan = planCsvImport(csv, EMPTY);

    expect(plan.newRatings[0] && 'notes' in plan.newRatings[0]).toBe(false);
  });

  it('keeps notes that contain commas', () => {
    const csv = [HEADER, 'Onyx,Geometry,5,espresso,2025-03-14,"syrupy, sweet, long finish"'].join(
      '\n',
    );

    const plan = planCsvImport(csv, EMPTY);

    expect(plan.newRatings[0]?.notes).toBe('syrupy, sweet, long finish');
  });

  it('rejects a file with no recognisable required columns', () => {
    expect(() => planCsvImport('what,when\n1,2', EMPTY)).toThrow(ImportFormatError);
  });

  it('rejects an empty file', () => {
    expect(() => planCsvImport('', EMPTY)).toThrow(ImportFormatError);
  });

  it('dates the created coffee from its earliest rating, not from today', () => {
    const csv = [HEADER, 'Onyx,Geometry,5,espresso,2025-03-14,'].join('\n');

    const plan = planCsvImport(csv, EMPTY);

    expect(plan.newBeans[0]?.createdAt.slice(0, 10)).toBe('2025-03-14');
  });

  it('imports its own template cleanly', () => {
    const plan = planCsvImport(CSV_TEMPLATE, EMPTY);

    expect(plan.errors).toHaveLength(0);
    expect(plan.newBeans).toHaveLength(2);
    expect(plan.newRatings).toHaveLength(2);
  });
});

describe('beanKey', () => {
  it('ignores case and repeated whitespace', () => {
    expect(beanKey(' Onyx ', 'Southern  Weather')).toBe(beanKey('onyx', 'southern weather'));
  });

  it('keeps different coffees apart', () => {
    expect(beanKey('Onyx', 'Geometry')).not.toBe(beanKey('Onyx', 'Southern Weather'));
  });
});
