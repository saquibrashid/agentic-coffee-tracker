import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean, PendingAiTask } from '@/types';

const mocks = vi.hoisted(() => ({
  autoEnrichBean: vi.fn(),
  isTerminalEnrichFailure: vi.fn(),
  extractBeanFromPhoto: vi.fn(),
}));

vi.mock('@/services/enrich/autoEnrich', () => mocks);

vi.mock('@/services/ai/pipeline', () => ({
  extractBeanFromPhoto: mocks.extractBeanFromPhoto,
  PipelineUnavailableError: class PipelineUnavailableError extends Error {},
}));

const { autoEnrichBean, isTerminalEnrichFailure, extractBeanFromPhoto } = mocks;

const { runQueueNow } = await import('./queueRunner');

function bean(overrides: Partial<CoffeeBean> = {}): CoffeeBean {
  return {
    id: 'b1',
    schemaVersion: 1,
    roaster: 'Onyx Coffee Lab',
    name: 'Southern Weather',
    source: 'manual',
    isArchived: false,
    needsReview: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function task(overrides: Partial<PendingAiTask> = {}): PendingAiTask {
  return {
    id: 't1',
    schemaVersion: 1,
    type: 'web-enrich',
    payload: { reason: 'bulk-import' },
    beanId: 'b1',
    attempts: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  autoEnrichBean.mockReset();
  isTerminalEnrichFailure.mockReset();
  extractBeanFromPhoto.mockReset();
  isTerminalEnrichFailure.mockReturnValue(false);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await Promise.all([db.beans.clear(), db.pendingAiTasks.clear(), db.photos.clear()]);
});

describe('queue runner: ocr roast level', () => {
  const parsed = {
    roaster: null,
    name: 'French Roast',
    origins: [],
    process: null,
    roastLevel: null,
    tastingNotes: [],
    roastDate: null,
    varietals: [],
    elevationMeters: null,
    roasterDescription: null,
    confidence: 0.8,
  };

  async function runOcr(existing: Partial<CoffeeBean>, parsedOverrides = {}) {
    await db.beans.add(bean(existing));
    await db.photos.add({ id: 'p1', kind: 'bag', blob: new Blob(['x']) } as never);
    await db.pendingAiTasks.add(task({ type: 'ocr', payload: { photoId: 'p1' } }));
    extractBeanFromPhoto.mockResolvedValue({
      parsed: { ...parsed, ...parsedOverrides },
      rawText: 'FRENCH ROAST',
      model: 'gpt-4o',
    });
    await runQueueNow();
    return db.beans.get('b1');
  }

  it('fills a missing roast level from the scanned name', async () => {
    expect((await runOcr({ roastLevel: 'unknown' }))?.roastLevel).toBe('dark');
  });

  it('never lets an inferred roast displace one the user chose', async () => {
    // A guess from a product name is weaker evidence than a level the user
    // picked, so it must lose -- even though the scan says "French Roast".
    expect((await runOcr({ roastLevel: 'light' }))?.roastLevel).toBe('light');
  });

  it('still lets a roast the model actually read replace an existing one', async () => {
    // This one was read off the bag, so it is at least as good as what is on
    // the record and the pre-existing "model wins" rule stands.
    expect((await runOcr({ roastLevel: 'light' }, { roastLevel: 'medium-dark' }))?.roastLevel).toBe(
      'medium-dark',
    );
  });
});

describe('queue runner: web-enrich', () => {
  it('applies the lookup to the coffee and clears the task', async () => {
    await db.beans.add(bean());
    await db.pendingAiTasks.add(task());
    autoEnrichBean.mockResolvedValue({
      update: { process: 'washed', tastingNotes: ['cocoa'] },
      sourceUrl: 'https://onyx.example/sw',
      filled: ['process', 'tastingNotes'],
    });

    await runQueueNow();

    const updated = await db.beans.get('b1');
    expect(updated?.process).toBe('washed');
    expect(updated?.tastingNotes).toEqual(['cocoa']);
    await expect(db.pendingAiTasks.count()).resolves.toBe(0);
  });

  it('never flags an enriched coffee for review', async () => {
    await db.beans.add(bean());
    await db.pendingAiTasks.add(task());
    autoEnrichBean.mockResolvedValue({
      update: { process: 'washed' },
      sourceUrl: 'https://onyx.example/sw',
      filled: ['process'],
    });

    await runQueueNow();

    // Unlike a photo parse, enrichment only fills gaps, so there is nothing for
    // the user to arbitrate and no reason to mark the whole import as suspect.
    expect((await db.beans.get('b1'))?.needsReview).toBe(false);
  });

  it('clears the task when the lookup found nothing new', async () => {
    await db.beans.add(bean());
    await db.pendingAiTasks.add(task());
    autoEnrichBean.mockResolvedValue(null);

    await runQueueNow();

    await expect(db.pendingAiTasks.count()).resolves.toBe(0);
  });

  it('drops the task when the coffee was deleted while it waited', async () => {
    await db.pendingAiTasks.add(task());

    await runQueueNow();

    expect(autoEnrichBean).not.toHaveBeenCalled();
    await expect(db.pendingAiTasks.count()).resolves.toBe(0);
  });

  it('backs off a transient failure so it is retried later', async () => {
    await db.beans.add(bean());
    await db.pendingAiTasks.add(task());
    autoEnrichBean.mockRejectedValue(new Error('network down'));
    isTerminalEnrichFailure.mockReturnValue(false);

    await runQueueNow();

    const remaining = await db.pendingAiTasks.get('t1');
    expect(remaining?.attempts).toBe(1);
    expect(remaining?.lastError).toBe('network down');
    expect(remaining?.nextAttemptAt).toBeDefined();
  });

  it('drops a failure that would fail identically forever', async () => {
    await db.beans.add(bean());
    await db.pendingAiTasks.add(task());
    autoEnrichBean.mockRejectedValue(new Error('no product page'));
    isTerminalEnrichFailure.mockReturnValue(true);

    await runQueueNow();

    await expect(db.pendingAiTasks.count()).resolves.toBe(0);
  });

  it('caps how many lookups run in a single pass', async () => {
    // A bulk import can queue dozens; draining them at once would fire a burst
    // of billable calls. The rest must survive for the next pass.
    const beans = Array.from({ length: 8 }, (_, i) => bean({ id: `b${i}` }));
    await db.beans.bulkAdd(beans);
    await db.pendingAiTasks.bulkAdd(beans.map((b, i) => task({ id: `t${i}`, beanId: b.id })));
    autoEnrichBean.mockResolvedValue(null);

    await runQueueNow();

    expect(autoEnrichBean).toHaveBeenCalledTimes(3);
    await expect(db.pendingAiTasks.count()).resolves.toBe(5);
  });

  it('respects the backoff window rather than retrying immediately', async () => {
    await db.beans.add(bean());
    await db.pendingAiTasks.add(
      task({ nextAttemptAt: new Date(Date.now() + 60_000).toISOString() }),
    );

    await runQueueNow();

    expect(autoEnrichBean).not.toHaveBeenCalled();
    await expect(db.pendingAiTasks.count()).resolves.toBe(1);
  });
});
