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
  it('queues a lookup for every imported coffee, since none arrives with a picture', async () => {
    // A spreadsheet can carry metadata but never an image, so even the fully
    // described row is worth looking up — for the photo if nothing else.
    const plan = planCsvImport([HEADER, SPARSE, FULL].join('\n'), { beans: [], ratings: [] });
    expect(plan.newBeans).toHaveLength(2);
    expect(countEnrichable(plan)).toBe(2);

    await applyImportPlan(plan, { enrich: true });

    const tasks = await db.pendingAiTasks.toArray();
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.type === 'web-enrich')).toBe(true);
    expect(tasks.every((t) => t.attempts === 0)).toBe(true);

    const queued = await Promise.all(tasks.map((t) => db.beans.get(t.beanId ?? '')));
    expect(queued.map((b) => b?.name).sort()).toEqual(['Bali', 'Geometry']);
  });

  it('queues nothing when enrichment is declined', async () => {
    const plan = planCsvImport([HEADER, SPARSE].join('\n'), { beans: [], ratings: [] });

    await applyImportPlan(plan, { enrich: false });

    await expect(db.pendingAiTasks.count()).resolves.toBe(0);
    await expect(db.beans.count()).resolves.toBe(1);
    await expect(db.ratings.count()).resolves.toBe(1);
  });

  it('writes the history whether or not a lookup was queued', async () => {
    const plan = planCsvImport([HEADER, FULL].join('\n'), { beans: [], ratings: [] });

    await applyImportPlan(plan, { enrich: true });

    await expect(db.ratings.count()).resolves.toBe(1);
    await expect(db.beans.count()).resolves.toBe(1);
  });
});
