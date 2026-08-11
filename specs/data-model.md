# Data Model Specification

This document defines all persistent data structures, the LLM output contract, and enums used by the app. All types are TypeScript and serializable to JSON.

---

## Conventions

- **IDs**: ULIDs (string, sortable, 26 chars). Generated client-side.
- **Timestamps**: ISO 8601 strings in UTC (`new Date().toISOString()`).
- **Dates without time** (e.g. roast date): `YYYY-MM-DD` string.
- **Optional fields**: marked `?`. Missing AI-extracted fields stay `undefined` (not `null`).
- **Schema versioning**: every persisted record carries `schemaVersion: number`. Current version: `1`.

---

## Enums

```ts
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
```

---

## CoffeeBean

```ts
export interface CoffeeBean {
  id: string; // ULID
  schemaVersion: 1;

  // Identity
  roaster: string; // required after confirmation
  name: string; // required after confirmation

  // Provenance
  origins?: Origin[]; // multi-origin blends supported
  process?: Process;
  roastLevel?: RoastLevel;
  varietals?: string[]; // e.g. ["Bourbon", "Typica"]
  elevationMeters?: { min?: number; max?: number };

  // Sensory
  tastingNotes?: string[]; // e.g. ["blueberry", "chocolate"]
  roasterDescription?: string; // free text from bag/web

  // Lifecycle
  roastDate?: string; // YYYY-MM-DD
  purchaseDate?: string; // YYYY-MM-DD
  bagSizeGrams?: number;
  pricePaid?: { amount: number; currency: string };

  // Media
  photoId?: string; // FK to Photo (blob store)
  thumbnailDataUrl?: string; // tiny base64 for fast list rendering

  // Provenance of data
  source: EntrySource;
  sourceUrl?: string; // if scraped
  confidence?: number; // 0–1, from LLM
  rawOcrText?: string; // kept for debugging / re-parsing
  llmModel?: string; // e.g. "gpt-4o-2024-08-06"

  // Status
  isArchived: boolean; // user marked as finished
  needsReview: boolean; // missing required fields

  // Audit
  createdAt: string;
  updatedAt: string;
}

export interface Origin {
  country: string; // ISO 3166-1 name, e.g. "Ethiopia"
  region?: string; // e.g. "Yirgacheffe"
  farm?: string;
  producer?: string;
  percentage?: number; // for blends, 0–100
}
```

**Required after user confirmation**: `roaster`, `name`. All others optional.

---

## Rating

```ts
export interface Rating {
  id: string; // ULID
  schemaVersion: 1;
  beanId: string; // FK → CoffeeBean.id

  score: number; // 1–10, allow halves (1, 1.5, ... 10)
  brewType: BrewType;
  notes?: string;
  ratedAt: string; // ISO 8601

  // Optional brew parameters
  brewParams?: {
    doseGrams?: number;
    yieldGrams?: number;
    waterGrams?: number;
    grindSetting?: string;
    waterTempC?: number;
    brewTimeSeconds?: number;
    ratio?: string; // e.g. "1:2"
  };

  // Optional media
  cupPhotoId?: string; // FK to Photo

  // Location/context
  location?: 'home' | 'cafe' | 'work' | 'other';
  cafeName?: string;

  createdAt: string;
  updatedAt: string;
}
```

Validation: `score` ∈ {1, 1.5, 2, ..., 9.5, 10}. `brewType` required.

---

## UserPreferences (derived)

Recomputed from ratings; never user-edited directly. Cached locally and invalidated on rating insert/update/delete.

```ts
export interface UserPreferences {
  id: 'singleton';
  schemaVersion: 1;
  computedAt: string;

  favoriteOrigins: RankedItem<string>[]; // country name
  favoriteRoasters: RankedItem<string>[];
  favoriteProcesses: RankedItem<Process>[];
  favoriteRoastLevels: RankedItem<RoastLevel>[];
  favoriteFlavors: RankedItem<string>[]; // from tastingNotes
  favoriteBrewTypes: RankedItem<BrewType>[];

  averageScore: number;
  totalRatings: number;
  totalBeans: number;
}

export interface RankedItem<T> {
  value: T;
  weightedScore: number; // see algorithm below
  count: number;
  averageScore: number;
}
```

### Ranking algorithm

For each candidate value `v` (e.g. an origin country):

```
weightedScore(v) = Σ over ratings r where bean(r) has v of:
                   (r.score - 5)            // center around neutral
                   * recencyWeight(r.ratedAt)
                   * (1 / numAttributes)    // dilute multi-origin blends
```

- `recencyWeight(t) = 0.5 ^ (ageDays / 180)` — 6-month half-life.
- Rank descending; keep top 10 per category.

---

## Photo (blob)

Stored in a separate IndexedDB object store to keep main records small.

```ts
export interface PhotoBlob {
  id: string; // ULID
  schemaVersion: 1;
  kind: 'bag' | 'cup';
  mimeType: string; // 'image/jpeg' | 'image/webp'
  blob: Blob; // original (downscaled, see Architecture)
  widthPx: number;
  heightPx: number;
  byteSize: number;
  createdAt: string;
}
```

---

## OcrResult (queue/debug record)

```ts
export interface OcrResult {
  id: string;
  photoId: string;
  rawText: string;
  provider: 'azure-vision';
  providerVersion?: string;
  createdAt: string;
}
```

---

## PendingAiTask (offline queue)

```ts
export interface PendingAiTask {
  id: string;
  schemaVersion: 1;
  type: 'ocr' | 'llm-parse' | 'web-enrich' | 'recommendation';
  payload: unknown; // typed per task type at runtime
  beanId?: string; // draft bean this task contributes to
  attempts: number;
  lastError?: string;
  nextAttemptAt?: string; // ISO; backoff schedule
  createdAt: string;
}
```

---

## LLM Output Contract

Use OpenAI **structured outputs** (JSON schema) with the schema below. The LLM MUST return this exact shape; unknown fields = `null`.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "roaster",
    "name",
    "origins",
    "process",
    "roastLevel",
    "tastingNotes",
    "roastDate",
    "varietals",
    "elevationMeters",
    "roasterDescription",
    "confidence"
  ],
  "properties": {
    "roaster": { "type": ["string", "null"] },
    "name": { "type": ["string", "null"] },
    "origins": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["country", "region", "farm", "producer", "percentage"],
        "properties": {
          "country": { "type": ["string", "null"] },
          "region": { "type": ["string", "null"] },
          "farm": { "type": ["string", "null"] },
          "producer": { "type": ["string", "null"] },
          "percentage": { "type": ["number", "null"] }
        }
      }
    },
    "process": {
      "type": ["string", "null"],
      "enum": ["washed", "natural", "honey", "anaerobic", "wet-hulled", "other", null]
    },
    "roastLevel": {
      "type": ["string", "null"],
      "enum": ["light", "medium-light", "medium", "medium-dark", "dark", null]
    },
    "tastingNotes": { "type": "array", "items": { "type": "string" } },
    "roastDate": { "type": ["string", "null"], "description": "YYYY-MM-DD" },
    "varietals": { "type": "array", "items": { "type": "string" } },
    "elevationMeters": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "required": ["min", "max"],
      "properties": {
        "min": { "type": ["number", "null"] },
        "max": { "type": ["number", "null"] }
      }
    },
    "roasterDescription": { "type": ["string", "null"] },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
  }
}
```

**System prompt (canonical):**

> You extract structured coffee bean metadata from OCR text of a coffee bag. Return ONLY fields present in or strongly implied by the text. Use null for anything unknown — do not guess. Normalize roast level and process to the provided enums. Output must match the supplied JSON schema exactly.

**Failure handling:**

- JSON parse failure → retry once at temperature 0.
- Schema validation failure → mark task `needsReview = true`, surface raw text to user.
- All fields null → suggest manual entry.

---

## Export Schemas

### `beans.csv`

Columns (in order):

```
id, roaster, name, origins, process, roastLevel, varietals,
tastingNotes, roastDate, purchaseDate, bagSizeGrams, priceAmount,
priceCurrency, source, sourceUrl, isArchived, createdAt, updatedAt
```

- `origins` serialized as `"Country/Region/Farm[ pct%]; Country2/..."`
- `tastingNotes` and `varietals` serialized as `;`-separated.
- Dates as ISO 8601.

### `ratings.csv`

```
id, beanId, roaster, name, score, brewType, notes, ratedAt,
doseGrams, yieldGrams, ratio, location, cafeName, createdAt
```

`roaster` and `name` duplicated for spreadsheet convenience.

### `export.json`

```json
{
  "exportedAt": "2026-06-09T13:48:00.000Z",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "beans": [/* CoffeeBean[] */],
  "ratings": [/* Rating[] */],
  "preferences": {/* UserPreferences */}
}
```

Photo blobs are **not** included in JSON export by default. A separate "Export with images" option zips a folder of `<photoId>.jpg` alongside `export.json`.

---

## IndexedDB Object Stores

| Store            | Key path | Indexes                                             |
| ---------------- | -------- | --------------------------------------------------- |
| `beans`          | `id`     | `roaster`, `createdAt`, `isArchived`, `needsReview` |
| `ratings`        | `id`     | `beanId`, `ratedAt`, `brewType`                     |
| `photos`         | `id`     | `kind`                                              |
| `ocrResults`     | `id`     | `photoId`                                           |
| `preferences`    | `id`     | —                                                   |
| `pendingAiTasks` | `id`     | `type`, `nextAttemptAt`                             |
| `meta`           | `key`    | — (key-value: schemaVersion, lastSummaryAt, etc.)   |

See `architecture.md` for the migration strategy.
