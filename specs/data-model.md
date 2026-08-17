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
  weightedScore: number; // 1-10; the average shrunk toward the user's baseline
  count: number;
  averageScore: number;
}
```

### Ranking algorithm

For each candidate value `v` (e.g. an origin country), shrink its own average
toward the user's overall average:

```
baseline      = mean(r.score) over all ratings
average(v)    = mean(r.score) over ratings whose bean has v
count(v)      = number of those ratings

weightedScore(v) = (count(v) * average(v) + K * baseline) / (count(v) + K)
```

- `K = PRIOR_STRENGTH = 5` — at 5 observations the ranked score sits halfway
  between the baseline and what `v` actually scored.
- Rank descending by `weightedScore`, ties broken by `count`; keep top 5.

Shrinkage can only pull a value _toward_ the baseline, never past it, so a value
the user scores below their own average can never outrank one they score above
it — however often they drink it. This is what makes the list an ordering by
preference rather than by frequency (issue #199).

`weightedScore` therefore shares the 1–10 scale with `averageScore`. It is not a
score multiplied by a count; an earlier implementation used
`average * log2(1 + count)`, which ranked partly by how often a value appeared
and put a note averaging 6.5 across 8 ratings above one averaging 9.0 across 2.

The rule lives in `services/ratings/shrink` because **Analytics answers the same
question from the same ratings** and must agree with the taste map. Until
issue #202 each screen had its own arithmetic — Analytics sorted by the raw
average and drew its bars from the rating count — so the two could order the
same history differently and both look authoritative. Its panels now carry:

- `count` — **ratings**, not cups and not distinct coffees.
- `beanCount` — how many different coffees those ratings came from. Shown when it
  is lower, because "9.0 from 6 ratings" reads like six coffees agreeing when it
  may be one coffee rated six times, which is far weaker evidence.
- `weightedScore` — what the list is ordered by _and_ what the bar length is drawn
  from, so the ordering the user sees matches the lengths they see.

Analytics returns every value rather than a top slice; the screen previews eight
and can expand. "Is that the full list?" is a question the page can only answer
if it knows what it is hiding.

Not yet implemented, and deliberately left out for now:

- **Recency weighting** (`0.5 ^ (ageDays / 180)`). Worth adding, but it changes
  what the number means, so it should land with UI that says the ranking is
  time-weighted.
- **Diluting multi-origin blends** by `1 / numAttributes`. See #199 on whether a
  blend belongs in the origins ranking at all.

---

## Prediction ("Will I like it?")

A verdict on a coffee the user has _not_ rated. Computed locally and
deterministically from their own history — never a model call — so it works
offline and can show its working.

```
baseline   = mean(r.score) over all ratings
average(a) = mean(r.score) over ratings whose bean carries attribute a
count(a)   = number of those ratings

score = (SUM w(a) * average(a) + K * baseline) / (SUM w(a) + K)     K = 2.5
```

### Attribute weight

```
w(a) = kindWeight(a) * log2(1 + count(a)) * informativeness(a) * proximity(a)
```

- `kindWeight` — origin 1, process 0.9, roaster 0.85, roast level 0.8,
  flavour 0.35. Flavour notes are marketing copy, so they are individually weak
  and only the four most informative count.
- `log2(1 + count)` — the tenth rating of something adds far less than the second.
- `informativeness = log2(1 + total/count) / log2(1 + total)`, normalised to 1
  for a value seen once. **Volume of evidence and value of evidence are not the
  same thing.** An attribute present in nearly every rating necessarily averages
  close to the baseline, so it distinguishes nothing — yet without this term its
  count gave it the largest weight of any attribute and pulled every verdict back
  to the middle, which is how two very different coffees returned the same score
  (issue #200).
- `proximity` — roast level only; see below.

The weights are then rescaled so their sum is unchanged by `informativeness`.
That term decides how evidence is _shared out_ between attributes, not how much
evidence there is; without the rescale it would also shrink the pool and pull
estimates further toward the baseline, the opposite of the intent.

### Roast level is ordinal

`light | medium-light | medium | medium-dark | dark` is a scale, not a set of
unrelated labels. An exact match wins outright; otherwise the nearest level the
user has actually rated stands in, weighted by distance
(`[1, 0.6, 0.3, 0.12, 0.04]`) and flagged `approximate` so the explanation says
so rather than implying they have rated that level. Previously a roast the user
had never rated counted as no evidence at all, even with plenty of history one
step along the scale.

### Confidence

```
confidence = evidence * history * coverage

evidence = SUM w(a) / (SUM w(a) + K)
history  = min(1, totalRatings / 10)
coverage = matchedKinds / 5
```

`coverage` is what stops a verdict resting on a single recognised attribute
presenting itself with the assurance of one resting on all five. Attributes the
bag never mentioned, and values with no history behind them, are dropped from the
average silently — so they have to be paid for in confidence instead.

Below `MIN_CONFIDENCE = 0.25` the verdict is always `unsure`, whatever the score.

### Resolution

The estimate is clamped into 1–10 and rounded to **one decimal**, via
`clampToScale`, _not_ `clampScore`. A rating is a choice a person makes, so it
must land on a selectable half-step; an estimate is not, and snapping it to
halves collapsed genuinely different answers onto the same number.

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
| `pendingAiTasks` | `id`     | `type`, `nextAttemptAt`, `beanId`                   |
| `meta`           | `key`    | — (key-value: schemaVersion, lastSummaryAt, etc.)   |

See `architecture.md` for the migration strategy.
