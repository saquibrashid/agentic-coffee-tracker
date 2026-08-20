import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import { computeAnalytics } from '@/services/analytics/compute';
import { canPredict, loadPredictionIndex } from '@/services/predict';
import { predict } from '@/services/predict/predict';
import { pendingCount } from '@/services/sync/outbox';
import type { CoffeeBean, Rating } from '@/types';
import {
  buildSampleData,
  countRealRatings,
  hasSampleData,
  loadSampleData,
  removeSampleData,
} from './sampleData';

function realBean(id: string): CoffeeBean {
  return {
    id,
    schemaVersion: 1,
    roaster: 'A Real Roaster',
    name: 'A Real Coffee',
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

function realRating(id: string, beanId: string): Rating {
  return {
    id,
    schemaVersion: 2,
    beanId,
    score: 8,
    brewType: 'latte',
    ratedAt: '2025-01-01T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

beforeEach(async () => {
  await db.beans.clear();
  await db.ratings.clear();
  await db.outbox.clear();
});

describe('buildSampleData', () => {
  it('flags every record, so nothing can be stranded when clearing', () => {
    const { beans, ratings } = buildSampleData();

    expect(beans.length).toBeGreaterThan(0);
    expect(ratings.length).toBeGreaterThan(0);
    expect(beans.every((b) => b.isSample === true)).toBe(true);
    expect(ratings.every((r) => r.isSample === true)).toBe(true);
  });

  it('points every rating at a bean it ships with', () => {
    const { beans, ratings } = buildSampleData();
    const ids = new Set(beans.map((b) => b.id));

    expect(ratings.every((r) => ids.has(r.beanId))).toBe(true);
  });

  it('never asks the user to review a coffee that is not theirs', () => {
    expect(buildSampleData().beans.every((b) => b.needsReview === false)).toBe(true);
  });

  it('dates the history behind the clock it is given', () => {
    const now = Date.parse('2026-06-01T12:00:00.000Z');
    const { beans, ratings } = buildSampleData(now);

    expect(ratings.every((r) => Date.parse(r.ratedAt) < now)).toBe(true);
    // The bean cannot post-date the first cup drunk from it.
    for (const bean of beans) {
      const own = ratings.filter((r) => r.beanId === bean.id);
      const earliest = Math.min(...own.map((r) => Date.parse(r.ratedAt)));
      expect(Date.parse(bean.createdAt)).toBeLessThanOrEqual(earliest);
    }
  });

  it('spreads the palate out, so the screens it feeds are not one flat blob', () => {
    const { beans, ratings } = buildSampleData();

    // A predictor needs contrast to find a preference, and the taste map needs
    // it to have any shape at all.
    expect(new Set(beans.map((b) => b.roastLevel)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(beans.map((b) => b.process)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(beans.map((b) => b.origins?.[0]?.country)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(beans.map((b) => b.roaster)).size).toBeGreaterThanOrEqual(3);

    const scores = ratings.map((r) => r.score);
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(4);
  });

  it('scores light East Africans above dark roasts, so there is a taste to find', () => {
    const { beans, ratings } = buildSampleData();
    const averageFor = (predicate: (b: CoffeeBean) => boolean) => {
      const ids = new Set(beans.filter(predicate).map((b) => b.id));
      const own = ratings.filter((r) => ids.has(r.beanId));
      return own.reduce((sum, r) => sum + r.score, 0) / own.length;
    };

    expect(averageFor((b) => b.roastLevel === 'light')).toBeGreaterThan(
      averageFor((b) => b.roastLevel === 'dark') + 3,
    );
  });
});

describe('loadSampleData', () => {
  it('queues nothing for sync, so made-up coffees cannot reach another device', async () => {
    await loadSampleData();

    // The whole containment strategy: samples are unsyncable because nothing
    // enqueues them, not because something filters them later.
    expect(await pendingCount()).toBe(0);
  });

  it('replaces rather than duplicating when loaded twice', async () => {
    await loadSampleData();
    const first = await db.beans.count();

    await loadSampleData();

    expect(await db.beans.count()).toBe(first);
  });

  it('leaves records the user added alone', async () => {
    await db.beans.add(realBean('mine'));
    await db.ratings.add(realRating('mine-r', 'mine'));

    await loadSampleData();

    expect(await db.beans.get('mine')).toBeDefined();
    expect(await countRealRatings()).toBe(1);
  });
});

describe('removeSampleData', () => {
  it('takes out every sample record and reports how many', async () => {
    await loadSampleData();
    const expected = (await db.beans.count()) + (await db.ratings.count());

    const removed = await removeSampleData();

    expect(removed).toBe(expected);
    expect(await db.beans.count()).toBe(0);
    expect(await db.ratings.count()).toBe(0);
    expect(await hasSampleData()).toBe(false);
  });

  it('does not touch what the user added', async () => {
    await db.beans.add(realBean('mine'));
    await db.ratings.add(realRating('mine-r', 'mine'));
    await loadSampleData();

    await removeSampleData();

    expect(await db.beans.toArray()).toHaveLength(1);
    expect(await db.ratings.toArray()).toHaveLength(1);
    expect(await db.beans.get('mine')).toBeDefined();
  });

  it('is safe to call when nothing is loaded', async () => {
    expect(await removeSampleData()).toBe(0);
  });

  it('queues no deletes for sync either', async () => {
    await loadSampleData();
    await db.outbox.clear();

    await removeSampleData();

    // Samples were never pushed, so a tombstone would be telling the server to
    // delete something it has never heard of.
    expect(await pendingCount()).toBe(0);
  });
});

describe('hasSampleData', () => {
  it('is false on a library with only real coffees in it', async () => {
    await db.beans.add(realBean('mine'));

    expect(await hasSampleData()).toBe(false);
  });

  it('is true once the samples are loaded', async () => {
    await loadSampleData();

    expect(await hasSampleData()).toBe(true);
  });
});

describe('countRealRatings', () => {
  it('counts only what the user recorded', async () => {
    await loadSampleData();
    await db.beans.add(realBean('mine'));
    await db.ratings.add(realRating('mine-r', 'mine'));

    expect(await countRealRatings()).toBe(1);
  });
});

describe('what the samples are actually for', () => {
  it('gives the predictor enough to answer confidently', async () => {
    // The point of the whole feature. If loading samples still left "Check"
    // saying "not enough to say", it would have demonstrated nothing.
    await loadSampleData();
    const index = await loadPredictionIndex();

    expect(canPredict(index)).toBe(true);

    const result = predict(
      {
        roaster: 'Sample Roasters',
        origins: [{ country: 'Ethiopia' }],
        process: 'washed',
        roastLevel: 'light',
        tastingNotes: ['jasmine'],
      },
      index,
    );

    expect(result.verdict).toBe('love');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('has a palate to disagree with, not just a high average', async () => {
    await loadSampleData();
    const index = await loadPredictionIndex();

    const dark = predict(
      {
        roaster: 'Supermarket Sample',
        origins: [{ country: 'Brazil' }],
        process: 'natural',
        roastLevel: 'dark',
        tastingNotes: ['smoky'],
      },
      index,
    );

    // A demo where everything scores well would teach the user that the
    // predictor always says yes.
    expect(dark.score).toBeLessThan(index.baseline);
    expect(['avoid', 'unsure']).toContain(dark.verdict);
  });

  it('fills the analytics screen it exists to demonstrate', async () => {
    await loadSampleData();

    const analytics = await computeAnalytics();

    expect(analytics.totalRatings).toBeGreaterThanOrEqual(10);
    expect(analytics.topOrigins.length).toBeGreaterThan(1);
  });
});
