import { ulid } from 'ulid';
import { db } from '@/services/db';
import { beanNeedsEnrichment } from '@/services/enrich/autoEnrich';
import { inferRoastLevel } from '@/services/enrich/inferRoast';
import { DEFAULT_BREW_TYPE } from '@/services/ratings/brewTypes';
import {
  LEGACY_MAX_SCORE,
  MAX_SCORE,
  MIN_SCORE,
  formatOutOf,
  rescaleLegacyScore,
  roundToStep,
} from '@/services/ratings/scale';
import { enqueueManyUpserts } from '@/services/sync/outbox';
import type {
  BrewType,
  CoffeeBean,
  Origin,
  PendingAiTask,
  Process,
  Rating,
  RoastLevel,
} from '@/types';
import { normaliseHeader, parseCsv, type CsvRow } from './csv';

export interface ApplyOptions {
  /** Queue a web lookup for every imported coffee that is missing metadata. */
  enrich?: boolean;
}

/**
 * Bulk import of an existing rating history from a spreadsheet.
 *
 * The unit of the file is a *rating*, not a coffee, because that is how people
 * actually keep this data — one line per cup they drank. Coffees are derived by
 * grouping rows on roaster + name, so a coffee rated five times is one bean with
 * five ratings rather than five duplicates.
 *
 * Nothing is written until the user has seen a plan. Import is the one operation
 * where a silent misparse can quietly poison the preference profile behind
 * recommendations, so every row either lands, is reported as a duplicate, or is
 * reported as an error with its line number.
 */

/** Accepted spellings for each column, normalised via `normaliseHeader`. */
const COLUMN_ALIASES: Record<string, string[]> = {
  roaster: ['roaster', 'brand', 'company', 'roastery', 'roasterName'],
  name: ['name', 'coffee', 'bean', 'coffeename', 'beanname', 'product', 'title'],
  score: ['score', 'rating', 'stars', 'star', 'rank', 'myrating'],
  brewType: ['brew', 'brewtype', 'method', 'brewmethod', 'preparation', 'drink'],
  ratedAt: ['date', 'ratedat', 'rateddate', 'datetried', 'when', 'day'],
  notes: ['notes', 'note', 'comment', 'comments', 'review', 'thoughts'],
  roastLevel: ['roast', 'roastlevel'],
  process: ['process', 'processing', 'processmethod'],
  origin: ['origin', 'origins', 'country'],
  tastingNotes: [
    'tastingnotes',
    'flavournotes',
    'flavornotes',
    'flavours',
    'flavors',
    'notesonbag',
  ],
};

/** Columns without which a row cannot become a rating. */
const REQUIRED_COLUMNS = ['roaster', 'name', 'score'] as const;

const BREW_TYPES: BrewType[] = [
  'espresso',
  'latte',
  'iced-latte',
  'cappuccino',
  'cortado',
  'americano',
  'drip',
  'pour-over',
  'french-press',
  'aeropress',
  'moka',
  'cold-brew',
  'other',
];

/** Everyday spellings mapped onto the stored enum. */
const BREW_SYNONYMS: Record<string, BrewType> = {
  icedlatte: 'iced-latte',
  ilatte: 'iced-latte',
  capp: 'cappuccino',
  cap: 'cappuccino',
  flatwhite: 'latte',
  filter: 'drip',
  batchbrew: 'drip',
  batch: 'drip',
  coffee: 'drip',
  pourover: 'pour-over',
  v60: 'pour-over',
  chemex: 'pour-over',
  kalita: 'pour-over',
  hario: 'pour-over',
  frenchpress: 'french-press',
  press: 'french-press',
  cafetiere: 'french-press',
  plunger: 'french-press',
  aero: 'aeropress',
  mokapot: 'moka',
  stovetop: 'moka',
  coldbrew: 'cold-brew',
  iced: 'cold-brew',
  espressoshot: 'espresso',
  shot: 'espresso',
  doubleshot: 'espresso',
  ristretto: 'espresso',
  longblack: 'americano',
};

const ROAST_SYNONYMS: Record<string, RoastLevel> = {
  light: 'light',
  lightmedium: 'medium-light',
  mediumlight: 'medium-light',
  medium: 'medium',
  mediumdark: 'medium-dark',
  darkmedium: 'medium-dark',
  dark: 'dark',
  blonde: 'light',
  cinnamon: 'light',
  city: 'medium',
  fullcity: 'medium-dark',
  french: 'dark',
  italian: 'dark',
  espresso: 'medium-dark',
};

const PROCESS_SYNONYMS: Record<string, Process> = {
  washed: 'washed',
  wet: 'washed',
  fullywashed: 'washed',
  natural: 'natural',
  dry: 'natural',
  drynatural: 'natural',
  honey: 'honey',
  pulpednatural: 'honey',
  redhoney: 'honey',
  yellowhoney: 'honey',
  blackhoney: 'honey',
  anaerobic: 'anaerobic',
  anaerobicnatural: 'anaerobic',
  carbonicmaceration: 'anaerobic',
  wethulled: 'wet-hulled',
  gilingbasah: 'wet-hulled',
};

export interface ImportIssue {
  /** 1-based line in the source file, so the user can go and fix it. */
  line: number;
  message: string;
}

export interface ImportPlan {
  /** Coffees that do not exist yet and will be created. */
  newBeans: CoffeeBean[];
  /** Ratings that will be added. */
  newRatings: Rating[];
  /** How many rows attached to a coffee that already existed. */
  matchedBeanCount: number;
  /** Rows that look identical to a rating already stored. */
  duplicates: ImportIssue[];
  /** Rows that could not be imported at all. */
  errors: ImportIssue[];
  /** Rows that imported, but with an assumption worth surfacing. */
  warnings: ImportIssue[];
  /** Data rows seen, excluding the header. */
  totalRows: number;
}

export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFormatError';
  }
}

/** Groups a roaster and coffee name into a single comparison key. */
export function beanKey(roaster: string, name: string): string {
  const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${clean(roaster)}\u0000${clean(name)}`;
}

/**
 * Two ratings are "the same" when they are the same score of the same coffee,
 * brewed the same way, on the same day. Deliberately day-granular: a re-import
 * of the same file should be a no-op even though rows without a date are
 * stamped with the time they were imported.
 */
function ratingKey(beanId: string, ratedAt: string, brewType: BrewType, score: number): string {
  return `${beanId}\u0000${ratedAt.slice(0, 10)}\u0000${brewType}\u0000${score}`;
}

export function parseScore(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;

  // "★★★★" / "★★★★☆" — star ratings are conventionally out of 5, so a filled
  // star is worth two points on the 1–10 scale.
  const filledStars = (text.match(/★/g) ?? []).length;
  if (filledStars > 0) return rescaleLegacyScore(filledStars);

  // "4/5" or "8/10" — an explicit denominator removes all ambiguity, so honour
  // it and rescale onto 1–10.
  const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (fraction) {
    const value = Number(fraction[1]);
    const outOf = Number(fraction[2]);
    if (outOf <= 0) return null;
    return roundToStep((value / outOf) * MAX_SCORE);
  }

  // A bare number is taken at face value on the 1–10 scale. It genuinely is
  // ambiguous — "4" could be 4/5 — but guessing per-cell would be worse than a
  // consistent rule, and planRatingsImport warns when a whole file looks like
  // it was written on the old 5-point scale.
  const number = /-?\d+(?:\.\d+)?/.exec(text);
  if (!number) return null;
  return roundToStep(Number(number[0]));
}

export function parseBrewType(raw: string): BrewType | null {
  const key = normaliseHeader(raw);
  if (!key) return null;
  if (BREW_SYNONYMS[key]) return BREW_SYNONYMS[key];
  const direct = BREW_TYPES.find((t) => normaliseHeader(t) === key);
  return direct ?? null;
}

/**
 * Returns an ISO timestamp, or null when the cell holds something that is not a
 * date. An unparseable date is an error rather than a silent "today", because
 * the date is what orders the whole history.
 */
export function parseDate(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  // Anchor plain YYYY-MM-DD at UTC noon so a negative local offset cannot roll
  // it back onto the previous day.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  // M/D/YYYY and M/D/YY, the default spreadsheet format in the US locale.
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (slash) {
    const rawYear = slash[3] ?? '';
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    const date = new Date(Date.UTC(year, Number(slash[1]) - 1, Number(slash[2]), 12));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function splitList(raw: string): string[] {
  return raw
    .split(/[;,/|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseOrigins(raw: string): Origin[] {
  return splitList(raw).map((country) => ({ country }));
}

/** Maps normalised headers onto our field names, ignoring columns we don't know. */
function mapColumns(header: string[]): Map<string, number> {
  const lookup = new Map<string, string>();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) lookup.set(normaliseHeader(alias), field);
  }

  const columns = new Map<string, number>();
  header.forEach((cell, index) => {
    const field = lookup.get(normaliseHeader(cell));
    // First occurrence wins, so a stray duplicate column cannot shadow the real one.
    if (field && !columns.has(field)) columns.set(field, index);
  });
  return columns;
}

export interface ExistingData {
  beans: CoffeeBean[];
  ratings: Rating[];
}

/**
 * Turns CSV text into a plan without touching the database. Pure, so the
 * grouping and de-duplication rules can be tested directly.
 */
export function planCsvImport(text: string, existing: ExistingData): ImportPlan {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) throw new ImportFormatError('That file has no rows in it.');
  const dataRows = rows.slice(1);
  const columns = mapColumns(header.cells);

  const missing = REQUIRED_COLUMNS.filter((field) => !columns.has(field));
  if (missing.length > 0) {
    throw new ImportFormatError(
      `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
        `Found: ${header.cells.filter((c) => c.trim()).join(', ') || '(nothing)'}.`,
    );
  }

  const plan: ImportPlan = {
    newBeans: [],
    newRatings: [],
    matchedBeanCount: 0,
    duplicates: [],
    errors: [],
    warnings: [],
    totalRows: dataRows.length,
  };

  // Beans already stored, plus beans invented earlier in this same file, so the
  // second row for a coffee attaches to the bean the first row created.
  const beansByKey = new Map<string, CoffeeBean>();
  for (const bean of existing.beans) beansByKey.set(beanKey(bean.roaster, bean.name), bean);

  const seenRatings = new Set<string>();
  for (const rating of existing.ratings) {
    seenRatings.add(ratingKey(rating.beanId, rating.ratedAt, rating.brewType, rating.score));
  }

  // Tracks bare (denominator-less) scores so a file that was clearly written on
  // the old 5-point scale can be flagged rather than silently halved in meaning.
  const bareScoreLines: number[] = [];
  let sawBareAboveLegacyMax = false;

  const cell = (row: CsvRow, field: string): string => {
    const index = columns.get(field);
    if (index === undefined) return '';
    return (row.cells[index] ?? '').trim();
  };

  const now = new Date().toISOString();

  for (const row of dataRows) {
    const line = row.line;
    const roaster = cell(row, 'roaster');
    const name = cell(row, 'name');

    if (!roaster && !name) {
      plan.errors.push({ line, message: 'No roaster or coffee name.' });
      continue;
    }
    if (!roaster) {
      plan.errors.push({ line, message: `Missing roaster for "${name}".` });
      continue;
    }
    if (!name) {
      plan.errors.push({ line, message: `Missing coffee name for "${roaster}".` });
      continue;
    }

    const rawScore = cell(row, 'score');
    const score = parseScore(rawScore);
    if (score === null) {
      plan.errors.push({ line, message: `Could not read a score from "${rawScore}".` });
      continue;
    }
    if (score < MIN_SCORE || score > MAX_SCORE) {
      plan.errors.push({
        line,
        message: `Score ${score} is outside ${MIN_SCORE}–${MAX_SCORE} (from "${rawScore}").`,
      });
      continue;
    }
    // A bare number on the new scale may have been written on the old one; the
    // rows are collected so a whole-file warning can be raised after the loop.
    if (!rawScore.includes('/') && !rawScore.includes('★')) {
      bareScoreLines.push(line);
      if (score > LEGACY_MAX_SCORE) sawBareAboveLegacyMax = true;
    }
    if (roundToStep(Number(rawScore)) !== Number(rawScore) && !rawScore.includes('/')) {
      plan.warnings.push({ line, message: `Rounded ${rawScore} to ${score}.` });
    }

    const rawBrew = cell(row, 'brewType');
    let brewType = parseBrewType(rawBrew);
    if (rawBrew && !brewType) {
      // A brew that was stated but not recognised stays "other" so the bad value
      // remains visible; only an *absent* brew falls back to the default.
      plan.warnings.push({ line, message: `Unrecognised brew "${rawBrew}", stored as "other".` });
      brewType = 'other';
    }
    if (!brewType) brewType = DEFAULT_BREW_TYPE;

    const rawDate = cell(row, 'ratedAt');
    let ratedAt = parseDate(rawDate);
    if (rawDate && !ratedAt) {
      plan.errors.push({ line, message: `Could not read a date from "${rawDate}".` });
      continue;
    }
    if (!ratedAt) {
      ratedAt = now;
      plan.warnings.push({ line, message: 'No date given, so today was used.' });
    }

    const key = beanKey(roaster, name);
    let bean = beansByKey.get(key);
    if (bean) {
      plan.matchedBeanCount += 1;
    } else {
      // Bean metadata is only taken on creation. An existing coffee keeps what
      // it already has rather than being overwritten by a thinner spreadsheet row.
      const origins = parseOrigins(cell(row, 'origin'));
      const tastingNotes = splitList(cell(row, 'tastingNotes'));
      // An explicit roast column wins. Failing that, the coffee's own name
      // often states it outright ("French Roast", "Blonde Roast") — and a
      // spreadsheet of ratings usually carries no roast column at all, so
      // without this the whole import lands as `unknown` and contributes
      // nothing to the preference profile it was imported to build.
      const roastLevel =
        ROAST_SYNONYMS[normaliseHeader(cell(row, 'roastLevel'))] ??
        inferRoastLevel({ name, tastingNotes })?.level;
      const process = PROCESS_SYNONYMS[normaliseHeader(cell(row, 'process'))];

      bean = {
        id: ulid(),
        schemaVersion: 1,
        roaster,
        name,
        source: 'manual',
        isArchived: false,
        // Imported rows were reviewed by the person who typed them; flagging the
        // whole library for review would make the flag meaningless.
        needsReview: false,
        createdAt: ratedAt,
        updatedAt: now,
        ...(origins.length > 0 ? { origins } : {}),
        ...(tastingNotes.length > 0 ? { tastingNotes } : {}),
        ...(roastLevel ? { roastLevel } : {}),
        ...(process ? { process } : {}),
      };
      beansByKey.set(key, bean);
      plan.newBeans.push(bean);
    }

    const dedupeKey = ratingKey(bean.id, ratedAt, brewType, score);
    if (seenRatings.has(dedupeKey)) {
      plan.duplicates.push({
        line,
        message: `${roaster} — ${name} (${formatOutOf(score)}) already recorded.`,
      });
      continue;
    }
    seenRatings.add(dedupeKey);

    const notes = cell(row, 'notes');
    plan.newRatings.push({
      id: ulid(),
      schemaVersion: 2,
      beanId: bean.id,
      score,
      brewType,
      ratedAt,
      createdAt: now,
      updatedAt: now,
      ...(notes ? { notes } : {}),
    });
  }

  // A bean invented for a row that then failed de-duplication would be created
  // with no ratings, which looks like a phantom coffee in the library.
  const beansWithRatings = new Set(plan.newRatings.map((r) => r.beanId));
  plan.newBeans = plan.newBeans.filter((b) => beansWithRatings.has(b.id));

  // If every bare score in the file would have been legal on the old 5-point
  // scale, the file was probably written on it. That cannot be proven, so the
  // import is not blocked — but importing "5" as mediocre when the user meant
  // top marks is the kind of error they would never spot afterwards.
  if (bareScoreLines.length > 0 && !sawBareAboveLegacyMax) {
    plan.warnings.push({
      line: bareScoreLines[0]!,
      message:
        `Every score is ${LEGACY_MAX_SCORE} or lower, so this file may use a 1–${LEGACY_MAX_SCORE} scale. ` +
        `Scores are read as out of ${MAX_SCORE}. Write them as "4/${LEGACY_MAX_SCORE}" to convert instead.`,
    });
  }

  return plan;
}

/** Reads the current library so a plan can be built against it. */
export async function loadExistingData(): Promise<ExistingData> {
  const [beans, ratings] = await Promise.all([db.beans.toArray(), db.ratings.toArray()]);
  return { beans, ratings };
}

/**
 * Commits a plan. Beans and ratings go in together so a failure part-way cannot
 * leave ratings pointing at coffees that were never written.
 *
 * When `enrich` is set, every imported coffee still missing metadata gets a
 * `web-enrich` task. The lookups deliberately happen *after* the commit rather
 * than during it: a spreadsheet of 200 cups would otherwise take minutes and
 * fail entirely offline, whereas the queue is durable, retries on its own, and
 * leaves the history usable immediately.
 */
export async function applyImportPlan(plan: ImportPlan, options: ApplyOptions = {}): Promise<void> {
  if (plan.newBeans.length === 0 && plan.newRatings.length === 0) return;

  const toEnrich = options.enrich ? plan.newBeans.filter(beanNeedsEnrichment) : [];
  const now = new Date().toISOString();
  const tasks: PendingAiTask[] = toEnrich.map((bean) => ({
    id: ulid(),
    schemaVersion: 1,
    type: 'web-enrich',
    payload: { reason: 'bulk-import' },
    beanId: bean.id,
    attempts: 0,
    createdAt: now,
  }));

  await db.transaction('rw', [db.beans, db.ratings, db.pendingAiTasks, db.outbox], async () => {
    if (plan.newBeans.length > 0) await db.beans.bulkAdd(plan.newBeans);
    if (plan.newRatings.length > 0) await db.ratings.bulkAdd(plan.newRatings);
    if (tasks.length > 0) await db.pendingAiTasks.bulkAdd(tasks);

    await enqueueManyUpserts(
      'bean',
      plan.newBeans.map((b) => b.id),
    );
    await enqueueManyUpserts(
      'rating',
      plan.newRatings.map((r) => r.id),
    );
  });
}

/** How many imported coffees would be queued for a web lookup. */
export function countEnrichable(plan: ImportPlan): number {
  return plan.newBeans.filter(beanNeedsEnrichment).length;
}

/** A ready-to-fill file, so nobody has to guess the column names. */
export const CSV_TEMPLATE = [
  '# Coffee Bean Tracker — rating import template',
  '# One row per cup you drank. Only roaster, coffee and score are required.',
  '# score is out of 10 — accepts 8.5, 4/5, 8/10 or stars. date accepts 2025-03-14 or 3/14/2025.',
  '# A blank brew is recorded as a latte.',
  'roaster,coffee,score,brew,date,notes,roast,process,origin,tasting notes',
  '"Anchorhead Coffee","Bali Kintamani",9.5,espresso,2025-03-14,"Syrupy, great as a cortado",medium,natural,Indonesia,"strawberry; cocoa; orange"',
  '"Onyx Coffee Lab","Southern Weather",8,pour-over,2025-03-16,,medium-light,washed,"Colombia; Ethiopia","chocolate; citrus"',
].join('\n');
