/**
 * An opt-in library of made-up coffees, so the screens that only mean something
 * once you have history can be seen working before you have any.
 *
 * Analytics, "For you" and the predictor are the most interesting things the
 * app does and the last things a new user can see, because each needs a dozen
 * ratings behind it. Until then they show empty states, which is honest but
 * gives no reason to come back. Sample data closes that gap without asking
 * anyone to invent twelve coffees they have not drunk (#241).
 *
 * ## Why these live in the real tables
 *
 * `computeAnalytics`, `refreshPreferences` and `loadPredictionIndex` each read
 * `db.beans` and `db.ratings` directly; there is no shared read layer to divert.
 * Keeping samples in a parallel store would mean duplicating all three
 * pipelines, and the tutorial would then be demonstrating code paths the user
 * will never actually run — a demo of a different app.
 *
 * ## What stops them leaking
 *
 * - **Sync.** Nothing uploads except what is explicitly queued: `takeBatch()`
 *   drains the outbox and enqueueing is done by hand at each mutation site.
 *   These rows are written without an outbox entry, so they are _structurally_
 *   unsyncable rather than filtered out by convention. `reset()` clears the
 *   outbox rather than rebuilding it from the tables, so nothing sweeps them up
 *   later either.
 * - **Export.** `services/export/exporter.ts` excludes anything flagged, so a
 *   backup never contains coffees the user did not drink.
 * - **Removal.** Every row carries `isSample`, so clearing is one delete and
 *   cannot strand a record the user then has to hunt down.
 *
 * ## Why the data looks like this
 *
 * A flat set of near-identical coffees would leave every screen technically
 * populated and completely uninformative: the taste map would be one blob and
 * the predictor would have no preference to find. So the palate here is
 * deliberately opinionated — light, washed and natural East Africans with
 * floral and berry notes score well; dark, roasty, earthy cups score badly;
 * Central and South American mediums sit in between. That gives Analytics a
 * real spread, "For you" a real signal, and the predictor something to be
 * confident about.
 */
import { db } from '@/services/db';
import type { CoffeeBean, Process, Rating, RoastLevel } from '@/types';

/** Prefix on every sample id, so one is recognisable in a debugger or a log. */
const SAMPLE_PREFIX = 'sample-';

interface SampleBean {
  id: string;
  roaster: string;
  name: string;
  country: string;
  region?: string;
  process: Process;
  roastLevel: RoastLevel;
  tastingNotes: string[];
  ratings: { score: number; daysAgo: number; brewType: Rating['brewType'] }[];
}

/**
 * Nine coffees and eighteen ratings — enough for the predictor's confidence to
 * clear its "not enough to say" floor and for the taste map to have shape,
 * without being so large that clearing it feels risky.
 */
const SAMPLE_BEANS: SampleBean[] = [
  {
    id: 'ethiopia-guji',
    roaster: 'Sample Roasters',
    name: 'Guji Uraga',
    country: 'Ethiopia',
    region: 'Guji',
    process: 'washed',
    roastLevel: 'light',
    tastingNotes: ['jasmine', 'bergamot', 'peach'],
    ratings: [
      { score: 9.5, daysAgo: 4, brewType: 'pour-over' },
      { score: 9, daysAgo: 26, brewType: 'pour-over' },
    ],
  },
  {
    id: 'ethiopia-yirgacheffe',
    roaster: 'Sample Roasters',
    name: 'Yirgacheffe Natural',
    country: 'Ethiopia',
    region: 'Yirgacheffe',
    process: 'natural',
    roastLevel: 'light',
    tastingNotes: ['blueberry', 'strawberry', 'dark chocolate'],
    ratings: [
      { score: 9, daysAgo: 11, brewType: 'aeropress' },
      { score: 8.5, daysAgo: 47, brewType: 'pour-over' },
    ],
  },
  {
    id: 'kenya-nyeri',
    roaster: 'Second Sample Coffee',
    name: 'Nyeri AA',
    country: 'Kenya',
    region: 'Nyeri',
    process: 'washed',
    roastLevel: 'medium-light',
    tastingNotes: ['blackcurrant', 'grapefruit', 'brown sugar'],
    ratings: [
      { score: 9, daysAgo: 7, brewType: 'pour-over' },
      { score: 8, daysAgo: 33, brewType: 'drip' },
    ],
  },
  {
    id: 'colombia-huila',
    roaster: 'Second Sample Coffee',
    name: 'Huila Pink Bourbon',
    country: 'Colombia',
    region: 'Huila',
    process: 'honey',
    roastLevel: 'medium-light',
    tastingNotes: ['red apple', 'caramel', 'orange'],
    ratings: [
      { score: 8, daysAgo: 15, brewType: 'espresso' },
      { score: 7.5, daysAgo: 40, brewType: 'latte' },
    ],
  },
  {
    id: 'guatemala-huehue',
    roaster: 'Sample Roasters',
    name: 'Huehuetenango',
    country: 'Guatemala',
    process: 'washed',
    roastLevel: 'medium',
    tastingNotes: ['milk chocolate', 'almond', 'cherry'],
    ratings: [
      { score: 7.5, daysAgo: 20, brewType: 'latte' },
      { score: 7, daysAgo: 55, brewType: 'drip' },
    ],
  },
  {
    id: 'costa-rica-tarrazu',
    roaster: 'Third Sample Roastery',
    name: 'Tarrazu Los Santos',
    country: 'Costa Rica',
    process: 'anaerobic',
    roastLevel: 'medium',
    tastingNotes: ['tropical fruit', 'honey', 'winey'],
    ratings: [
      { score: 8.5, daysAgo: 2, brewType: 'pour-over' },
      { score: 7, daysAgo: 62, brewType: 'aeropress' },
    ],
  },
  {
    id: 'brazil-cerrado',
    roaster: 'Third Sample Roastery',
    name: 'Cerrado Espresso',
    country: 'Brazil',
    process: 'natural',
    roastLevel: 'medium-dark',
    tastingNotes: ['peanut', 'toffee', 'cocoa'],
    ratings: [
      { score: 6, daysAgo: 18, brewType: 'espresso' },
      { score: 5.5, daysAgo: 51, brewType: 'moka' },
    ],
  },
  {
    id: 'sumatra-mandheling',
    roaster: 'Third Sample Roastery',
    name: 'Mandheling',
    country: 'Indonesia',
    region: 'Sumatra',
    process: 'wet-hulled',
    roastLevel: 'dark',
    tastingNotes: ['earthy', 'cedar', 'tobacco'],
    ratings: [
      { score: 4, daysAgo: 30, brewType: 'french-press' },
      { score: 4.5, daysAgo: 66, brewType: 'drip' },
    ],
  },
  {
    id: 'house-dark',
    roaster: 'Supermarket Sample',
    name: 'House Dark Roast',
    country: 'Brazil',
    process: 'natural',
    roastLevel: 'dark',
    tastingNotes: ['smoky', 'burnt sugar', 'ash'],
    ratings: [
      { score: 3.5, daysAgo: 9, brewType: 'drip' },
      { score: 3, daysAgo: 44, brewType: 'americano' },
    ],
  },
];

function daysAgoIso(days: number, now: number): string {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Builds the records without touching the database, so the shape can be tested
 * directly and every date resolves against one clock rather than drifting
 * across a slow insert.
 */
export function buildSampleData(now: number = Date.now()): {
  beans: CoffeeBean[];
  ratings: Rating[];
} {
  const beans: CoffeeBean[] = [];
  const ratings: Rating[] = [];

  for (const sample of SAMPLE_BEANS) {
    const beanId = `${SAMPLE_PREFIX}bean-${sample.id}`;
    // Dated to the oldest cup rather than to now: a library where every coffee
    // was added in the same second looks like exactly what it is.
    const oldest = Math.max(...sample.ratings.map((r) => r.daysAgo));

    beans.push({
      id: beanId,
      schemaVersion: 1,
      roaster: sample.roaster,
      name: sample.name,
      origins: [{ country: sample.country, ...(sample.region ? { region: sample.region } : {}) }],
      process: sample.process,
      roastLevel: sample.roastLevel,
      tastingNotes: sample.tastingNotes,
      source: 'manual',
      isArchived: false,
      // Never true: a sample coffee asking to be reviewed would send the user
      // off to correct data that is not theirs and does not matter.
      needsReview: false,
      isSample: true,
      createdAt: daysAgoIso(oldest, now),
      updatedAt: daysAgoIso(oldest, now),
    });

    for (const [i, cup] of sample.ratings.entries()) {
      ratings.push({
        id: `${SAMPLE_PREFIX}rating-${sample.id}-${i}`,
        schemaVersion: 2,
        beanId,
        score: cup.score,
        brewType: cup.brewType,
        ratedAt: daysAgoIso(cup.daysAgo, now),
        location: 'home',
        isSample: true,
        createdAt: daysAgoIso(cup.daysAgo, now),
        updatedAt: daysAgoIso(cup.daysAgo, now),
      });
    }
  }

  return { beans, ratings };
}

/**
 * Adds the sample library.
 *
 * Deliberately does **not** enqueue anything for sync. Every other write path
 * in the app calls `enqueueUpsert` straight after its `put`; the omission here
 * is the entire mechanism keeping made-up coffees off the user's other devices,
 * so it is load-bearing rather than an oversight.
 *
 * Idempotent: ids are fixed, so loading twice replaces rather than duplicates.
 */
export async function loadSampleData(now: number = Date.now()): Promise<void> {
  const { beans, ratings } = buildSampleData(now);
  await db.transaction('rw', db.beans, db.ratings, async () => {
    await db.beans.bulkPut(beans);
    await db.ratings.bulkPut(ratings);
  });
}

/** Removes every sample record, returning how many rows went. */
export async function removeSampleData(): Promise<number> {
  return db.transaction('rw', db.beans, db.ratings, async () => {
    const beans = await db.beans.filter((b) => b.isSample === true).toArray();
    const ratings = await db.ratings.filter((r) => r.isSample === true).toArray();
    await db.beans.bulkDelete(beans.map((b) => b.id));
    await db.ratings.bulkDelete(ratings.map((r) => r.id));
    return beans.length + ratings.length;
  });
}

/** Whether any sample record is currently loaded. */
export async function hasSampleData(): Promise<boolean> {
  const found = await db.beans.filter((b) => b.isSample === true).first();
  return found !== undefined;
}

/**
 * How many ratings the user has actually recorded.
 *
 * Used to decide whether to suggest clearing the samples: once there is real
 * history, made-up coffees stop being scaffolding and start being noise in the
 * user's own averages.
 */
export async function countRealRatings(): Promise<number> {
  return db.ratings.filter((r) => r.isSample !== true).count();
}
