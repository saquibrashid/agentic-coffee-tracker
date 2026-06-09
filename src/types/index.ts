/**
 * Canonical data types. Mirrors specs/data-model.md.
 * Keep these in sync with the spec — the spec is the source of truth.
 */

export type RoastLevel =
  | 'light'
  | 'medium-light'
  | 'medium'
  | 'medium-dark'
  | 'dark'
  | 'unknown';

export type Process =
  | 'washed'
  | 'natural'
  | 'honey'
  | 'anaerobic'
  | 'wet-hulled'
  | 'other'
  | 'unknown';

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

  createdAt: string;
  updatedAt: string;
}

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
  schemaVersion: 1;
  beanId: string;

  score: number;
  brewType: BrewType;
  notes?: string;
  ratedAt: string;

  brewParams?: BrewParams;
  cupPhotoId?: string;

  location?: 'home' | 'cafe' | 'work' | 'other';
  cafeName?: string;

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

export interface PhotoBlob {
  id: string;
  schemaVersion: 1;
  kind: 'bag' | 'cup';
  mimeType: string;
  blob: Blob;
  widthPx: number;
  heightPx: number;
  byteSize: number;
  createdAt: string;
}

export interface OcrResult {
  id: string;
  photoId: string;
  rawText: string;
  provider: 'azure-vision';
  providerVersion?: string;
  createdAt: string;
}

export type AiTaskType = 'ocr' | 'llm-parse' | 'web-enrich' | 'recommendation';

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
