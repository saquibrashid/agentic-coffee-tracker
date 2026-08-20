/**
 * Canonical data types. Mirrors specs/data-model.md.
 * Keep these in sync with the spec — the spec is the source of truth.
 */

export type RoastLevel = 'light' | 'medium-light' | 'medium' | 'medium-dark' | 'dark' | 'unknown';

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
