/**
 * Canonical data types. Mirrors specs/data-model.md.
 * Keep these in sync with the spec — the spec is the source of truth.
 */

export type RoastLevel = 'light' | 'medium-light' | 'medium' | 'medium-dark' | 'dark' | 'unknown';

/**
 * How much caffeine is in the bag.
 *
 * A three-way enum with an explicit `unknown`, matching `RoastLevel` and
 * `Process`, rather than a `decaf` boolean. A boolean has to answer "is this
 * decaf?" for every coffee ever recorded, including the ones nobody looked at —
 * and its `false` would mean both "confirmed caffeinated" and "never asked".
 * That is the exact conflation this field exists to remove, and it would force
 * extraction to guess on every bag that does not mention caffeine at all.
 *
 * `half-caf` is a real product rather than a completeness exercise: blends sold
 * as half-caf are common enough to buy by accident, and they belong with
 * neither group when the question is what to drink in the evening.
 */
export type CaffeineLevel = 'caffeinated' | 'decaf' | 'half-caf' | 'unknown';

/**
 * The form the coffee arrives in.
 *
 * Not who sold it. Cometeer flash-freezes other roasters' brewed coffee into
 * pucks, so a Cometeer box of Counter Culture coffee has Counter Culture as its
 * roaster and `'cometeer'` as its form; Nespresso and K-Cup are the same shape
 * of thing. The shop in between — a grocery store, a marketplace — is not
 * recorded at all, because which shop a coffee came from says nothing about
 * the coffee.
 *
 * A closed set rather than free text is deliberate: it is what stops a retailer
 * name landing here the moment a receipt is parsed.
 */
export type CoffeeFormat = 'whole-bean' | 'ground' | 'cometeer' | 'nespresso' | 'k-cup' | 'instant';

export type Process =
  'washed' | 'natural' | 'honey' | 'anaerobic' | 'wet-hulled' | 'other' | 'unknown';

export type BrewType =
  | 'espresso'
  | 'latte'
  | 'iced-latte'
  | 'cappuccino'
  | 'cortado'
  | 'americano'
  | 'drip'
  | 'pour-over'
  | 'french-press'
  | 'aeropress'
  | 'moka'
  | 'cold-brew'
  | 'other';

export type EntrySource = 'photo-ocr' | 'manual' | 'barcode' | 'url-scrape' | 'voice';

export interface Origin {
  country: string;
  region?: string;
  farm?: string;
  producer?: string;
  percentage?: number;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface CoffeeBean {
  id: string;
  schemaVersion: 1;

  roaster: string;
  name: string;

  origins?: Origin[];
  process?: Process;
  roastLevel?: RoastLevel;
  /**
   * How the coffee is packaged, when it is not an ordinary bag of beans.
   *
   * Absent means whole bean, which is what `formatForNewBean` records for every
   * coffee added from now on; a coffee saved before this field existed is also
   * absent and is read the same way. Nothing treats a blank as a gap worth
   * looking up, and background enrichment cannot write this field at all —
   * Counter Culture's own page would otherwise "correct" a Cometeer puck to
   * whole beans, which is exactly backwards.
   */
  format?: CoffeeFormat;
  /**
   * Deliberately optional and deliberately not part of `schemaVersion`.
   *
   * Bumping the version would make every device running an older build refuse
   * these records with `NeedsUpgradeError` and halt sync entirely, which is far
   * worse than the field being absent. An additive optional key needs no such
   * treatment: old builds ignore it, and because every write is a partial
   * `db.beans.update()` and sync stores the whole payload, a record that
   * round-trips through an old device comes back with the value intact.
   *
   * Absent means the same as `'unknown'` — every coffee recorded before this
   * field existed. Read it through `caffeineOf()` rather than directly.
   */
  caffeine?: CaffeineLevel;
  varietals?: string[];
  elevationMeters?: { min?: number; max?: number };

  tastingNotes?: string[];
  roasterDescription?: string;

  roastDate?: string;
  purchaseDate?: string;
  bagSizeGrams?: number;
  pricePaid?: Money;

  photoId?: string;
  thumbnailDataUrl?: string;

  source: EntrySource;
  sourceUrl?: string;
  /**
   * The page the user added this coffee from, which is not always the page its
   * details were read from.
   *
   * Cometeer is the case that forced the distinction: it flash-freezes other
   * roasters' coffee, so a Cometeer product page and Counter Culture's own page
   * describe the same beans in different packaging. Enrichment searches for the
   * roaster and finds the roaster's page, then stamps `sourceUrl` with it —
   * correct as provenance, but it silently replaced the link the user had
   * supplied, leaving the coffee pointing at a bag they did not buy.
   *
   * So the two are kept apart by who owns them. `sourceUrl` belongs to whatever
   * read the details last and may change with every lookup; this belongs to the
   * user. Capture writes it when the user supplied an address, and after that
   * only the user changes it — nothing automatic ever does. A coffee added from
   * a photo has no address to record, so the bean page lets one be added by
   * hand. The same split covers pods and subscription boxes without needing to
   * model them.
   */
  vendorUrl?: string;
  confidence?: number;
  rawOcrText?: string;
  llmModel?: string;

  isArchived: boolean;
  needsReview: boolean;

  /**
   * Marks a record loaded by the sample-data tutorial rather than one the user
   * entered. Sample records live in the real tables on purpose — Analytics, For
   * you and the predictor each read those tables directly, so anything else
   * would demonstrate code paths the user will never actually use. The flag is
   * what keeps them containable: it is the handle for removing them in one
   * action and for excluding them from exports. They are kept out of sync by
   * never being queued in the outbox, not by this flag.
   */
  isSample?: boolean;

  /**
   * What the last web lookup for this coffee actually did.
   *
   * A lookup used to leave no trace: the queue deleted the task whether it
   * filled fields, found nothing new, or gave up permanently, so "4 coffees are
   * missing details" stayed at 4 after a run with nothing anywhere to say why
   * (#246). Recording the outcome on the coffee is what makes the answer
   * durable — it survives navigation, it survives a reload, and it is attached
   * to the thing it is about rather than to a run the user has to remember.
   */
  lastLookupAt?: string;
  lastLookupOutcome?: LookupOutcome;

  createdAt: string;
  updatedAt: string;
}

/**
 * `not-found` and `failed` are kept apart because they mean different things to
 * the user: nothing on the roaster's store matched this coffee (usually an
 * abbreviated imported name, which editing the name can fix), versus the lookup
 * itself broke (which retrying can fix).
 */
export type LookupOutcome =
  /** Filled at least one gap, or attached a photo. */
  | 'filled'
  /** Found the product page, but it carried nothing the coffee was missing. */
  | 'nothing-new'
  /** No product page matched. Retrying the same search will fail the same way. */
  | 'not-found'
  /** The lookup itself errored out. */
  | 'failed';

export interface BrewParams {
  doseGrams?: number;
  yieldGrams?: number;
  waterGrams?: number;
  grindSetting?: string;
  waterTempC?: number;
  brewTimeSeconds?: number;
  ratio?: string;
}

export interface Rating {
  id: string;
  /** v1 scored 1–5; v2 scores 1–10 in half-steps. See services/ratings/scale.ts. */
  schemaVersion: 2;
  beanId: string;

  /** 1–10, half-steps allowed. */
  score: number;
  brewType: BrewType;
  notes?: string;
  ratedAt: string;

  brewParams?: BrewParams;
  cupPhotoId?: string;

  location?: 'home' | 'cafe' | 'work' | 'other';
  cafeName?: string;

  /** See `CoffeeBean.isSample`. */
  isSample?: boolean;

  createdAt: string;
  updatedAt: string;
}

export interface RankedItem<T> {
  value: T;
  weightedScore: number;
  count: number;
  averageScore: number;
}

export interface UserPreferences {
  id: 'singleton';
  schemaVersion: 1;
  computedAt: string;

  favoriteOrigins: RankedItem<string>[];
  favoriteRoasters: RankedItem<string>[];
  favoriteProcesses: RankedItem<Process>[];
  favoriteRoastLevels: RankedItem<RoastLevel>[];
  favoriteFlavors: RankedItem<string>[];
  favoriteBrewTypes: RankedItem<BrewType>[];

  averageScore: number;
  totalRatings: number;
  totalBeans: number;
}

/**
 * What a stored image *is*, which decides what may be done with it.
 *
 * `bag-studio` is a picture of the bag that a model re-drew from another photo
 * (`services/enrich/studioPhoto.ts`). It is decoration and nothing else: the
 * model can quietly alter a logo or a word, so details read off one would be
 * invented details indistinguishable from real ones. Every extraction path —
 * OCR, `/api/parse`, any future re-parse — must refuse it and use
 * `sourcePhotoId` instead.
 */
export type PhotoKind = 'bag' | 'cup' | 'bag-studio';

export interface PhotoBlob {
  id: string;
  schemaVersion: 1;
  kind: PhotoKind;
  mimeType: string;
  blob: Blob;
  widthPx: number;
  heightPx: number;
  byteSize: number;
  createdAt: string;
  /**
   * The photo this one was generated from, set only on `bag-studio`.
   *
   * The original is evidence and is kept: it is what a re-parse must read, and
   * what reverting a studio shot puts back. A generated photo whose source has
   * gone is still displayable — it just cannot be reverted or re-read.
   */
  sourcePhotoId?: string;
}

/**
 * A record type that participates in sync.
 *
 * `specs/sync.md` → Scope of synchronised data. Deliberately excludes derived
 * and device-local state: `preferences` is recomputed from ratings,
 * `ocrResults` is a cache keyed to a photo, and `pendingAiTasks` is a work
 * queue whose entries mean nothing on another device.
 */
export type SyncRecordType = 'bean' | 'rating' | 'photo';

/**
 * One pending local change, waiting to be pushed.
 *
 * Two deliberate choices, both from `specs/sync.md` → Dexie v3 migration:
 *
 * - **Upserts carry no payload.** The record is read fresh from its table at
 *   push time, so a queued entry can never push a stale snapshot, and repeated
 *   edits to one record collapse into a single push.
 * - **This doubles as the tombstone store.** A delete removes the row and
 *   writes an entry carrying `deletedAt`, which avoids adding a `deletedAt`
 *   column to `CoffeeBean` and `Rating` — that would force every existing query
 *   in the app to filter soft-deleted rows.
 */
export interface OutboxEntry {
  id: string;
  type: SyncRecordType;
  recordId: string;
  op: 'upsert' | 'delete';
  /** Set when `op === 'delete'`; the LWW clock for the tombstone. */
  deletedAt?: string;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface OcrResult {
  id: string;
  photoId: string;
  rawText: string;
  provider: 'azure-vision';
  providerVersion?: string;
  createdAt: string;
}

export type AiTaskType =
  | 'ocr'
  | 'llm-parse'
  | 'web-enrich'
  | 'recommendation'
  /** Re-shoot a coffee's bag photo as a studio product shot. Costs money per run. */
  | 'studio-photo';

export interface PendingAiTask {
  id: string;
  schemaVersion: 1;
  type: AiTaskType;
  payload: unknown;
  beanId?: string;
  attempts: number;
  lastError?: string;
  nextAttemptAt?: string;
  createdAt: string;
}
