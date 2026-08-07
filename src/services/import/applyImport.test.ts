import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import { applyImportPlan, countEnrichable, planCsvImport } from './ratingsImport';

const HEADER = 'roaster,coffee,score,brew,date,notes,roast,process,origin,tasting notes';
const SPARSE = 'Onyx,Geometry,5,espresso,2025-03-14,';
const FULL = 'Anchorhead,Bali,4,latte,2025-03-15,,medium,natural,Indonesia,"strawberry; cocoa"';

beforeEach(async () => {
  await Promise.all([db.beans.clear(), db.ratings.clear(), db.pendingAiTasks.clear()]);
});

describe('applyImportPlan enrichment queue', () => {
  it('queues a lookup only for coffees missing metadata', async () => {
    const plan = planCsvImport([HEADER, SPARSE, FULL].join('\n'), { beans: [], ratings: [] });
    expect(plan.newBeans).toHaveLength(2);
    expect(countEnrichable(plan)).toBe(1);

    await applyImportPlan(plan, { enrich: true });

    const tasks = await db.pendingAiTasks.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.type).toBe('web-enrich');
    expect(tasks[0]?.attempts).toBe(0);

    const queuedBean = await db.beans.get(tasks[0]?.beanId ?? '');
    expect(queuedBean?.name).toBe('Geometry');
  });

  it('queues nothing when enrichment is declined', async () => {
    const plan = planCsvImport([HEADER, SPARSE].join('\n'), { beans: [], ratings: [] });

    await applyImportPlan(plan, { enrich: false });

    await expect(db.pendingAiTasks.count()).resolves.toBe(0);
    await expect(db.beans.count()).resolves.toBe(1);
    await expect(db.ratings.count()).resolves.toBe(1);
  });

  it('still writes the history when there is nothing to enrich', async () => {
    const plan = planCsvImport([HEADER, FULL].join('\n'), { beans: [], ratings: [] });

    await applyImportPlan(plan, { enrich: true });

    await expect(db.pendingAiTasks.count()).resolves.toBe(0);
    await expect(db.ratings.count()).resolves.toBe(1);
  });
});
