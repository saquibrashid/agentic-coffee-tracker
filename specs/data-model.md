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

export type CaffeineLevel = 'caffeinated' | 'decaf' | 'half-caf' | 'unknown';

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
  caffeine?: CaffeineLevel; // absent means nobody has answered; see below
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
  sourceUrl?: string; // where the details were last read from
  vendorUrl?: string; // where the user added it from; never overwritten
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

### Two addresses, because a coffee is sold in more than one place

Cometeer flash-freezes other roasters' coffee, so a Cometeer product page and
Counter Culture's own page describe the same beans in different packaging.
Roasting attribution already handles this correctly — the roaster is Counter
Culture, and Cometeer is not modelled as one — but the link back to the coffee
did not.

The two fields are split by who owns them:

- **`sourceUrl` belongs to whatever read the details last.** Enrichment searches
  for the roaster, finds the roaster's page and stamps it here. It is provenance,
  and it may change with every lookup.
- **`vendorUrl` belongs to the user.** It is written once, at capture, from the
  address they supplied, and nothing overwrites it.

Before the split there was only `sourceUrl`, so enrichment silently replaced the
Cometeer address the user had entered with a Counter Culture bag they never
bought. The bean page now shows both when they differ, labelled by host rather
than by a fixed "the roaster's site" — the app cannot tell a roaster's own
storefront from a reseller's, so it should not claim to.

The same split covers pods, subscription boxes and any other reseller without
needing to model them as a concept.

### Caffeine

Decaf is not a variant of a coffee, it is a different drink made from one. The
decaffeination process strips aromatics and flattens acidity, so a decaf scored
6 and a caffeinated coffee scored 6 are not the same judgement. Averaging them
produces a taste profile belonging to nobody, and drags recommendations toward
whichever group the user drinks more of — usually caffeinated, which makes a
decaf the user enjoyed count as evidence against their own preferences.

Three rules follow, and every consumer reads them from
`src/services/beans/caffeine.ts` rather than re-deriving them:

- **Absent means unanswered, never "caffeinated".** `caffeineOf` normalises a
  missing value to `unknown` and nothing infers otherwise from silence. This is
  a rule about _reading_ stored data, and it is what lets `caffeine` be an
  enrichable field: an inference that guessed "caffeinated" from an absence
  would have every web lookup propose overwriting a decaf set by hand.
- **`unknown` compares equal to everything.** Treating it as its own group would
  split the library in half on the day the field shipped and leave the
  preference engine nothing to learn from.
- **`half-caf` is its own value, not a kind of decaf.** It is a distinct
  product, and folding it in would let the filter and the preference engine
  disagree about the same bag.

#### Writing: caffeinated is the default

Reading is agnostic; _writing_ is not. A coffee being recorded now is assumed
caffeinated unless its own text says otherwise (`DEFAULT_CAFFEINE`, applied via
`caffeineForNewBean`). That is a claim about the world rather than about the
data — essentially all coffee sold is caffeinated, and decaf is the case a
roaster marks prominently, because it is the reason someone buys it.

Storing `unknown` instead would be honest and useless: it records ignorance the
app does not have, and it excludes the coffee from the one distinction the field
was added to draw.

The assumption is applied only where it can be corrected — at capture, where it
is the pre-filled value on a form the user is about to confirm, and by
`backfillCaffeine`, a self-limiting pass that gives every pre-existing coffee a
value on app start and never revisits one that has an answer. That pass writes
locally only — no `updatedAt` bump, no outbox row. It is a pure function of
`name` and `roasterDescription`, which already sync, so every device derives the
same answer for itself; uploading it once resurrected a bean deleted on another
device, because the upsert carried a fresh timestamp and won last-write-wins. A
corrected value is the opposite case and does sync, being a fact no other device
can derive.

The correction itself lives on the bean's own page: caffeine is the single bean
attribute editable by hand, because it is the only one assumed rather than read,
and a web lookup cannot fix it — there is no evidence on the product page to
find. Enrichment can still propose decaf over the assumption; it arrives as a
conflict and is left unchecked rather than applied silently.

`schemaVersion` stays at `1`. The field is optional and additive, so an older
build reads and re-writes a record carrying it without loss; bumping the version
would halt sync on every device that has not updated.

The AI contract (`ParsedBean`) omits `unknown` deliberately — the model answers
`null` when it cannot tell, and the client maps that to `unknown`. Offering both
would let the same absence arrive two different ways.

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
    "caffeine",
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
    "caffeine": {
      "type": ["string", "null"],
      "enum": ["caffeinated", "decaf", "half-caf", null],
      "description": "Only when the text says so. Ordinary coffee is not labelled caffeinated; silence means null."
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

**System prompt:** `api/src/lib/parsePrompt.ts` holds the canonical text, and
`parsePrompt.test.ts` pins the clauses that were added to fix a specific
misparse. It is not reproduced here — a copy in prose drifts from the one that
actually runs, and this section already had, telling the model its input was
always "OCR text of a coffee bag" long after the endpoint began receiving
product pages, datasheets and pasted prose.

**Not every page is about one coffee.** A shop's listing page, a "build your own
box" page or a category page describes many coffees at once. The prompt tells
the model to return nulls in that case rather than merge them, because a merged
coffee does not exist and looks like an answer. Nothing structural in the page
reveals this reliably: the Cometeer page that prompted the rule carries a single
schema.org `Product` block, and that block names the box rather than any coffee.
The model is the only step in the chain that can see the page holds forty
coffees, so it has to be permitted to say so.

**Failure handling:**

- JSON parse failure → retry once at temperature 0.
- Schema validation failure → mark task `needsReview = true`, surface raw text to user.
- More than `MAX_PLAUSIBLE_ORIGINS` (6) origins → rejected as a failed parse, on
  the same path. Blends of five or six components are real, so this is a ceiling
  rather than a rule against multiple origins; beyond it the count is not a
  recipe but evidence that two coffees' worth of text were never separated. The
  whole result is discarded rather than the list trimmed, because text that
  merged forty coffees merged their names and notes too — trimming would leave
  that in place and make it look deliberate.
- All fields null → suggest manual entry.

---

## Export Schemas

### `beans.csv`

Columns (in order):

```
id, roaster, name, origins, process, roastLevel, caffeine, varietals,
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
