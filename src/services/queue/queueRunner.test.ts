import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/services/db';
import type { CoffeeBean, PendingAiTask } from '@/types';

const mocks = vi.hoisted(() => ({
  autoEnrichBean: vi.fn(),
  isTerminalEnrichFailure: vi.fn(),
  isNotFoundFailure: vi.fn(),
  extractBeanFromPhoto: vi.fn(),
  prepareStudioPhoto: vi.fn(),
  applyStudioPhoto: vi.fn(),
  isTerminalStudioFailure: vi.fn(),
  sourcePhotoFor: vi.fn(),
}));

vi.mock('@/services/enrich/autoEnrich', () => mocks);

vi.mock('@/services/enrich/studioPhoto', () => ({
  prepareStudioPhoto: mocks.prepareStudioPhoto,
  applyStudioPhoto: mocks.applyStudioPhoto,
  isTerminalStudioFailure: mocks.isTerminalStudioFailure,
  sourcePhotoFor: mocks.sourcePhotoFor,
}));

vi.mock('@/services/ai/pipeline', () => ({
  extractBeanFromPhoto: mocks.extractBeanFromPhoto,
  PipelineUnavailableError: class PipelineUnavailableError extends Error {},
}));

const {
  autoEnrichBean,
  isTerminalEnrichFailure,
  isNotFoundFailure,
  extractBeanFromPhoto,
  prepareStudioPhoto,
  applyStudioPhoto,
  isTerminalStudioFailure,
  sourcePhotoFor,
} = mocks;

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
  prepareStudioPhoto.mockReset();
  applyStudioPhoto.mockReset();
  isTerminalStudioFailure.mockReset();
  sourcePhotoFor.mockReset();
  isTerminalEnrichFailure.mockReturnValue(false);
  isTerminalStudioFailure.mockReturnValue(false);
  // The extraction paths ask for the photograph behind a photo; the default is
  // that the stored photo is itself a real one.
  sourcePhotoFor.mockImplementation((photoId: string) => db.photos.get(photoId));
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

  /**
   * #246: every one of these paths used to end in a silent delete, so a run
   * that filled nothing was indistinguishable from a button that was never
   * pressed. The outcome has to outlive the task.
   */
  it('records that a lookup filled the coffee in', async () => {
    await db.beans.add(bean());
    await db.pendingAiTasks.add(task());
    autoEnrichBean.mockResolvedValue({ update: { process: 'washed' } });

    await runQueueNow();

    const stored = await db.beans.get('b1');
    expect(stored?.lastLookupOutcome).toBe('filled');
    expect(stored?.lastLookupAt).toBeDefined();
  });

  it('records that a lookup found nothing new', async () => {
    await db.beans.add(bean());
    await db.pendingAiTasks.add(task());
    autoEnrichBean.mockResolvedValue(null);

    await runQueueNow();

    await expect(db.beans.get('b1')).resolves.toMatchObject({ lastLookupOutcome: 'nothing-new' });
  });

  it('separates "no product page" from a lookup that broke', async () => {
    await db.beans.add(bean());
    await db.pendingAiTasks.add(task());
    autoEnrichBean.mockRejectedValue(new Error('no product page'));
    isTerminalEnrichFailure.mockReturnValue(true);
    isNotFoundFailure.mockReturnValue(true);

    await runQueueNow();

    await expect(db.beans.get('b1')).resolves.toMatchObject({ lastLookupOutcome: 'not-found' });

    await db.pendingAiTasks.add(task());
    isNotFoundFailure.mockReturnValue(false);

    await runQueueNow();

    await expect(db.beans.get('b1')).resolves.toMatchObject({ lastLookupOutcome: 'failed' });
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

describe('queue runner: studio-photo', () => {
  it('applies the generated photo and clears the task', async () => {
    await db.beans.add(bean({ photoId: 'p1' }));
    await db.pendingAiTasks.add(task({ type: 'studio-photo', payload: { reason: 'bulk' } }));
    prepareStudioPhoto.mockResolvedValue({ staged: {}, sourcePhotoId: 'p1' });

    await runQueueNow();

    expect(applyStudioPhoto).toHaveBeenCalled();
    await expect(db.pendingAiTasks.count()).resolves.toBe(0);
  });

  it('drops a coffee that lost its photo while the task waited', async () => {
    await db.beans.add(bean());
    await db.pendingAiTasks.add(task({ type: 'studio-photo' }));

    await runQueueNow();

    expect(prepareStudioPhoto).not.toHaveBeenCalled();
    await expect(db.pendingAiTasks.count()).resolves.toBe(0);
  });

  it('drops a refusal rather than paying to retry it hourly', async () => {
    await db.beans.add(bean({ photoId: 'p1' }));
    await db.pendingAiTasks.add(task({ type: 'studio-photo' }));
    prepareStudioPhoto.mockRejectedValue(new Error('model refused'));
    isTerminalStudioFailure.mockReturnValue(true);

    await runQueueNow();

    await expect(db.pendingAiTasks.count()).resolves.toBe(0);
  });

  it('backs off a transient failure instead of dropping it', async () => {
    await db.beans.add(bean({ photoId: 'p1' }));
    await db.pendingAiTasks.add(task({ type: 'studio-photo' }));
    prepareStudioPhoto.mockRejectedValue(new Error('offline'));

    await runQueueNow();

    const remaining = await db.pendingAiTasks.get('t1');
    expect(remaining?.attempts).toBe(1);
    expect(remaining?.nextAttemptAt).toBeDefined();
  });

  it('generates only one image per pass', async () => {
    // Tighter than the enrichment budget on purpose: every one of these is a
    // billed image, so a bulk run stays a slow background job.
    const beans = Array.from({ length: 4 }, (_, i) => bean({ id: `b${i}`, photoId: 'p1' }));
    await db.beans.bulkAdd(beans);
    await db.pendingAiTasks.bulkAdd(
      beans.map((b, i) => task({ id: `t${i}`, beanId: b.id, type: 'studio-photo' })),
    );
    prepareStudioPhoto.mockResolvedValue({ staged: {}, sourcePhotoId: 'p1' });

    await runQueueNow();

    expect(applyStudioPhoto).toHaveBeenCalledTimes(1);
    await expect(db.pendingAiTasks.count()).resolves.toBe(3);
  });
});

describe('queue runner: generated photos are never read', () => {
  it('reads the original photograph behind a studio shot', async () => {
    const original = new Blob(['real']);
    await db.beans.add(bean());
    await db.photos.add({ id: 'gen', kind: 'bag-studio', blob: new Blob(['drawn']) } as never);
    await db.pendingAiTasks.add(task({ type: 'ocr', payload: { photoId: 'gen' } }));
    sourcePhotoFor.mockResolvedValue({ id: 'p1', blob: original });
    extractBeanFromPhoto.mockResolvedValue({ parsed: null, rawText: '', model: 'gpt-4o' });

    await runQueueNow();

    expect(extractBeanFromPhoto).toHaveBeenCalledWith(original);
  });

  it('drops the task when only a generated photo survives', async () => {
    // A model that redraws packaging can invent text, and details parsed off an
    // invented label would be indistinguishable from real ones.
    await db.beans.add(bean());
    await db.photos.add({ id: 'gen', kind: 'bag-studio', blob: new Blob(['drawn']) } as never);
    await db.pendingAiTasks.add(task({ type: 'ocr', payload: { photoId: 'gen' } }));
    sourcePhotoFor.mockResolvedValue(null);

    await runQueueNow();

    expect(extractBeanFromPhoto).not.toHaveBeenCalled();
    await expect(db.pendingAiTasks.count()).resolves.toBe(0);
  });
});
