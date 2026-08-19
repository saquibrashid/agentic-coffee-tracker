# Architecture Specification

This document covers the system topology, secrets handling, network boundaries, offline strategy, storage internals, and migrations.

---

## High-level Topology

```
┌──────────────────────────────┐         ┌────────────────────────────┐
│  Browser (PWA)               │  HTTPS  │  BFF (Azure Functions)     │
│  React + TS + Vite           │ ──────▶ │  Node 20, Bicep-deployed   │
│  IndexedDB (Dexie)           │         │  /api/ocr, /api/parse,     │
│  Service Worker (Workbox)    │         │  /api/search, /api/scrape, │
│                              │         │  /api/recommend, /api/health│
└──────────────┬───────────────┘         └─────────────┬──────────────┘
               │                                       │
               │                              ┌────────┴────────┐
               │                              │                 │
               ▼                              ▼                 ▼
        Camera / Files               Azure AI Vision     Azure OpenAI
                                     Bing Web Search     (gpt-4o)
```

**Why a BFF is required (non-negotiable):**

- Azure Vision and Azure OpenAI keys must NEVER be shipped in the browser.
- Web scraping from a browser is blocked by CORS for most roaster sites.
- The BFF lets us add rate limiting, caching, and content moderation centrally.

The BFF is intentionally thin — it forwards requests, attaches keys, and normalizes responses. Business logic stays client-side so the app remains usable offline once data is local.

---

## Hosting

| Concern        | Choice                                    | Notes                          |
| -------------- | ----------------------------------------- | ------------------------------ |
| Static hosting | **Azure Static Web Apps (Standard)**      | Built-in Functions integration |
| API runtime    | Azure Functions (Node 20, consumption)    | Co-located with SWA            |
| Auth (v1)      | None                                      | App is single-user, local-only |
| Auth (v2)      | SWA built-in auth (Microsoft)             | Placeholder module from day 1  |
| IaC            | Bicep in `/infra`                         | `azd up` deployable            |
| CI/CD          | GitHub Actions (provided by SWA template) | PR previews enabled            |

---

## BFF Endpoints

All endpoints accept/return JSON. All are POST. All require an `x-app-version` header (used for telemetry & deprecation).

### `POST /api/ocr`

```
Request:  { imageBase64: string, mimeType: string }
Response: { rawText: string, provider: 'azure-vision', providerVersion: string }
Errors:   413 too large, 429 rate-limited, 502 upstream
```

Max payload: 8 MB. Server downscales further if needed before calling Azure Vision.

### `POST /api/parse`

```
Request:  { ocrText: string, model?: string }
Response: { parsed: <LLM Output schema>, model: string, rawText: string }
Errors:   400 missing ocrText, 422 model output failed schema validation, 429 rate-limited, 500 upstream
```

Uses Azure OpenAI **structured outputs** with the schema in `data-model.md`, sent over the
v1 Responses API (`POST {endpoint}/openai/v1/responses`, `text.format` = `json_schema`
with `strict: true`) via the shared client in `api/src/lib/openai.ts`. The response is
then re-validated server-side by
`api/src/lib/beanSchema.ts` before it is returned — structured outputs are a strong
hint, not a guarantee, and an unvalidated object would silently corrupt local data.

Validation is forgiving about _omissions_ (missing keys are backfilled with `null`/`[]`
and `confidence` defaults to `0`) but strict about _wrong_ values (bad types, unknown
properties, out-of-enum `process`/`roastLevel`, `confidence` outside `0..1`).

On failure the endpoint answers **422** with:

```
{ error: string, details: string[], model: string, rawText: string, rawContent: string }
```

This is an expected outcome, not a transient fault: the client must not retry it. It
should save the bean with `needsReview = true` and surface `rawText` for manual entry.

### `POST /api/search`

```
Request:  { roaster: string, name: string, max?: number }
Response: { results: { url, title, snippet }[] }
```

Calls Bing Web Search v7. Cached server-side for 24h keyed by `(roaster|name)`.

### `POST /api/scrape`

```
Request:  { url: string }
Response: { extracted: <partial LLM Output schema>, sourceUrl: string, imageUrl?: string }
```

Fetches, sanitizes HTML, runs LLM extraction with the same JSON schema. Allowlist of domains (roaster sites + known coffee retailers); deny-by-default for unknown domains in v1.

`imageUrl` is the product shot found on the page (`og:image`, then `twitter:image`,
then `link rel="image_src"`, then the first plausible `<img>`), absolutised against
the final URL. It is a _pointer_, not the image — the client passes it to
`/api/image` to actually download it.

### `POST /api/image`

```
Request:  { url: string }
Response: { dataUrl: string, contentType: string, byteSize: number, sourceUrl: string }
Errors:   400 invalid/blocked URL, 415 not a supported image, 429 rate-limited, 502 upstream failure
```

A binary proxy so the client can obtain a roaster's product photo. Two reasons it
cannot be a direct browser fetch: roaster CDNs send no CORS headers, and the SSRF
guard (private-range and redirect checks, shared with `/api/scrape`) must stay
server-side.

The response is only ever a real bitmap: the payload is sniffed by magic number
and must be PNG, JPEG, WebP, GIF, or AVIF. **SVG is deliberately rejected** — it
is active content, and this data URL is rendered in the app. Capped at 6 MB.

The client resizes the result through the same canvas pipeline as a camera
capture, so an enriched photo is indistinguishable downstream from one the user
took.

Because both images have been through that identical pipeline by the time they
meet, they can be compared fairly. When a coffee already has a picture, the
found one is offered as a replacement only if it carries at least **1.25x the
pixel area** — roughly 1.12x in each dimension, past the point where the
difference shows on a library card. Resolution is the only criterion, since
"better" is otherwise a matter of taste: a studio render is not objectively an
improvement on a photo of the bag on the user's own counter. The swap is always
the user's explicit choice, shown side by side with both dimensions, and the
replaced photo is deleted only once nothing else references it. Unattended
enrichment during a bulk import never replaces an existing photo, because there
is nobody there to choose.

### `POST /api/recommend`

```
Request:  { preferences: <PreferenceSummary>, max?: number }
Response: { recommendations: Recommendation[], model: string, reason?: 'insufficient-history' }
Errors:   400 missing/invalid summary, 422 model output failed validation, 429 rate-limited, 500 upstream
```

`PreferenceSummary` is an **anonymous** projection of `UserPreferences`: ranked
values with counts and average scores only. Bean names, tasting notes, photos,
dates, and prices never leave the device.

Each `Recommendation` must populate `basedOn` with the preference values it is
grounded in. The server rejects (422) any suggestion with an empty `basedOn` —
an ungrounded suggestion is exactly the hallucination this endpoint guards
against. The prompt also forbids inventing roaster names, products, prices, or
availability; the model describes the _kind_ of coffee to look for.

Below `totalRatings < 3` the endpoint short-circuits to an empty list with
`reason: 'insufficient-history'` rather than calling the model at all.

### `GET /api/health`

```
Response: { status: 'ok', version, timestamp, services: { ocr, parse, search, recommend } }
```

The only **anonymous** endpoint; every other route uses function-key auth. Each
service reports `'live'` when its credentials are present or `'mock'` when the
endpoint will return deterministic synthetic data. Used by the deploy workflow's
smoke test and by the Application Insights availability test.

---

## Secrets & Configuration

| Name                                    | Where         | Notes                                                            |
| --------------------------------------- | ------------- | ---------------------------------------------------------------- |
| `AZURE_VISION_ENDPOINT`/`KEY`           | Functions app | Stored in Key Vault reference                                    |
| `AZURE_OPENAI_ENDPOINT`/`KEY`           | Functions app | Key Vault reference                                              |
| `AZURE_OPENAI_DEPLOYMENT`               | Functions app | Model deployment name                                            |
| `SCRAPE_ALLOWLIST`                      | Functions app | Comma-separated hosts; empty allows any public host              |
| `ALLOWED_ORIGINS`                       | Functions app | Comma-separated; SWA hostname                                    |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Functions app | Set by Bicep; enables host telemetry                             |
| `VITE_API_BASE_URL`                     | Client build  | Empty on SWA Standard (linked backend); Function App URL on Free |

Every AI secret is **optional**. Bicep only creates a Key Vault secret and its
app setting when a value was supplied, and each endpoint falls back to a
schema-shaped mock when its variables are absent — so a credential-free
deployment is a supported configuration.

**Local dev**: `.env.local` (gitignored) for Functions; `local.settings.json` template committed without values.

---

## Styling & Component Library

**Stack:** Tailwind CSS + shadcn/ui (Radix UI primitives) + lucide-react icons.

### Choices and rationale

- **Tailwind CSS 3.x** — utility-first, JIT-compiled. Production stylesheet typically 5–15 KB gzipped (tree-shaken by class usage). Fits the 180 KB initial JS budget without competing for it (CSS is separate).
- **shadcn/ui** — accessible component primitives (Button, Dialog, DropdownMenu, Tabs, Toast, Form, Input, Select, Sheet, Tooltip, Popover, Command, Skeleton, Sonner). **Not a dependency** — components are generated into `src/components/ui/` and owned by this repo. Upgrade by re-running the CLI per component.
- **Radix UI** — the headless primitives shadcn/ui wraps. Provides keyboard nav, focus management, and ARIA semantics needed to satisfy `ux-states.md` accessibility rules.
- **lucide-react** — tree-shakable icons (~1 KB each). Single icon library project-wide; no mixing with other icon sets.
- **`tailwind-merge` + `clsx`** — class composition helpers used by the shadcn `cn()` utility.
- **`tailwindcss-animate`** — animation utilities required by shadcn/ui components.

### Folder & file conventions

```
src/
  components/
    ui/                  # shadcn/ui generated primitives — owned, edited freely
      button.tsx
      card.tsx
      badge.tsx
      control.ts         # the class string every text control shares
      input.tsx
      select.tsx         # native <select>: the OS picker beats a listbox on a phone
      textarea.tsx
      label.tsx
      checkbox-field.tsx # checkbox + label as one 44px row
      empty-state.tsx
      roast-scale.tsx
      confirm-dialog.tsx
      skeleton.tsx
    [feature-specific components live under features/<feature>/components/]
  styles/
    globals.css          # Tailwind directives + CSS variables (theme tokens)
  lib/
    utils.ts             # cn() helper from shadcn
tailwind.config.ts       # theme extension, content globs, plugins
postcss.config.js
components.json          # shadcn CLI config
```

### Theme tokens

Colors and radii are defined as CSS variables in `globals.css` (HSL channels, shadcn convention) and referenced from `tailwind.config.ts`. This makes dark mode and brand re-skinning a one-file change.

```css
/* src/styles/globals.css (excerpt — the file is authoritative) */
@import 'tailwindcss';

@layer base {
  :root {
    --background: 30 33% 96%; /* warm paper, so cards lift off it */
    --foreground: 25 30% 15%;
    --primary: 25 60% 30%; /* deep espresso */
    --border: 30 22% 85%; /* decoration */
    --input: 28 18% 52%; /* a control boundary — held to 3:1 */
    --radius: 0.75rem;
    /* ...full shadcn token set... */
  }
  .dark {
    --background: 24 30% 13%; /* deep roasted brown, not near-black */
    --foreground: 30 30% 95%;
    --primary: 28 70% 60%; /* warm crema */
    /* ... */
  }
}
```

`--border` and `--input` are deliberately different values. `--border` is
decoration between surfaces; `--input` is the edge that tells a user a control
exists, which WCAG 1.4.11 holds to 3:1. They were previously identical, which
left every text field outlined at 1.25:1 — present in the markup, invisible on
screen.

`--destructive` is asserted against `--background` and `--card` at the full
4.5:1 body-text ratio, not the 3:1 a button fill would need, because it is also
used directly as text (`text-destructive`). That gap was invisible until
`CardTitle` shrank from 24px to 18px and the "Danger zone" heading dropped out
of the large-text exemption.

### Typography

- **Body** stays on the system sans stack. It costs nothing to load, and it is
  already the face the reader's OS tuned for small sizes.
- **Headings** use **Fraunces** — a warm variable serif, self-hosted from
  `@fontsource-variable/fraunces`, latin subset, weight axis only (~35 KB
  woff2). Applied at the element level (`h1`–`h4`) rather than per call site, so
  a new page cannot forget it.
- `font-display: swap`, so a slow font never means invisible headings. The
  fallback is Georgia rather than the body sans: a serif dropping to a serif is
  a far smaller visual jump.
- Not loaded from a font CDN. That is an extra connection on the critical path
  and discloses the reader's IP to a third party on every page view.
- `text-meta` (in `globals.css`) is the letterspaced uppercase treatment for
  field names — origin, process, roast date. Uppercased in CSS, so screen
  readers and copy-paste still get the original casing.
- Assertions live in `src/styles/typography.test.ts`.

### Texture

A faint kraft grain is drawn on `body::before` with two layered repeating
gradients — no image asset, so it costs nothing against the Lighthouse budget,
and it is re-tinted for dark mode because a dark grain on a dark page is
invisible. Deliberately not a brown gradient wash: the intent is that surfaces
stop reading as flat rectangles, not that the page announces "coffee".

### Roast scale

`components/ui/roast-scale.tsx` renders roast level as five swatches running
light to dark. The swatch values are **literal hex, not theme tokens**: a roast
level means the same thing in both themes, so recolouring it per theme would be
recolouring the data. The ring around each swatch _is_ theme-derived, because a
near-black dark-roast swatch has no edge against a dark card. Colour is never
the only channel — the level is written alongside, or moved into the accessible
name in the compact form (WCAG 1.4.1).

### Dark mode

- Class strategy (`darkMode: 'class'`).
- Three-way preference — **System / Light / Dark** — in Settings → Appearance. A
  two-way toggle is deliberately rejected: once it has been touched there is no
  way back to following the device.
- Default = follow `prefers-color-scheme`, and keep following it live. While the
  preference is `system` a `matchMedia` listener re-applies the theme when the
  device changes, so a phone that dims at sunset is tracked without a reload.
- **Stored in `localStorage`, not the `meta` IndexedDB store.** This spec
  originally said `meta`, and that turns out to be impossible: the theme has to
  be applied before the first paint or the app visibly flashes the wrong palette
  on every load, and IndexedDB reads are asynchronous, so its value does not
  exist yet at that moment. A synchronous store is therefore mandatory and
  `localStorage` is the only one. Keeping a copy in `meta` as well was rejected —
  a second source that can disagree with the one actually used at boot is worse
  than a documented deviation. See `src/services/theme/theme.ts`.
- Applied by an **inline script in `index.html`**, which duplicates a few lines
  of that module on purpose; an imported module runs after first paint and so
  cannot prevent the flash. `theme.test.ts` asserts the copy still agrees with
  the module.
- `color-scheme` is set alongside the class so browser-drawn UI (scrollbars,
  native controls) matches. Without it a dark page keeps white scrollbars.
- `<meta name="theme-color">` is rewritten to the active background so browser
  chrome matches. The PWA manifest colours cannot follow the theme — they are
  read once at install time — so they track the light palette. On iOS the
  home-screen app's status bar is filled with `theme-color`, so
  `apple-mobile-web-app-status-bar-style` is `default` rather than
  `black-translucent`: the translucent style forces light status-bar text, which
  disappears against the cream header in light mode.
- The dark background is a **deep roasted brown**, not near-black: below roughly
  12% lightness the hue stops being perceptible and a warm palette reads as
  grey. Contrast for every pairing in both palettes is asserted in
  `src/styles/contrast.test.ts` rather than checked by eye.
- All shadcn components handle dark variants natively via the token set above.

### Rules

0. **Form controls come from `components/ui`, never hand-styled at the call
   site.** There were nine copies of the same class string across the app and
   they had already drifted — some carried a focus ring, some did not, and every
   one of them was `h-10` against the 44px minimum touch target in
   `specs/ux-states.md`. `control.ts` holds the shared string; `input.tsx`,
   `select.tsx` and `textarea.tsx` consume it. A control that needs to differ
   passes `className`, which merges rather than replaces.
1. **No runtime CSS-in-JS** (no styled-components / Emotion). Build-time only.
2. **No second component library.** Don't mix MUI/Chakra/Ant alongside shadcn.
3. **No second icon library.** lucide-react only.
4. **Feature components import primitives from `@/components/ui/*`**, never from Radix directly (so we can layer behavior in shadcn wrappers).
5. **Arbitrary Tailwind values** (`p-[13px]`) are allowed but discouraged; prefer extending the theme scale.
6. **`@apply` is allowed** in `components/ui/*` to keep primitive markup readable; avoid in feature components.
7. **All interactive components must hit the WCAG 2.1 AA contrast and keyboard requirements** in `ux-states.md` — Radix gives this for free, but custom compositions need manual checks.

### Required shadcn components (initial generation list)

`button`, `card`, `dialog`, `sheet`, `dropdown-menu`, `tabs`, `tooltip`, `popover`, `select`, `input`, `textarea`, `label`, `form`, `toast` (or `sonner`), `skeleton`, `badge`, `separator`, `command` (for the bean search palette), `progress`, `slider` (for rating), `switch`, `alert-dialog` (for destructive confirms).

### Charts

Use **Recharts** for analytics screens. It styles via CSS variables, so theme tokens flow through. Lazy-loaded per `architecture.md` performance budgets.

### Bundle impact (estimates, gzipped)

| Item                              | Size                           |
| --------------------------------- | ------------------------------ |
| Tailwind production CSS (typical) | 8–12 KB                        |
| Radix primitives (sum of used)    | 15–25 KB                       |
| shadcn/ui generated TS            | counted in your code, not deps |
| lucide-react (per icon used)      | ~0.5–1.5 KB                    |
| `tailwind-merge` + `clsx`         | ~3 KB                          |
| **Total style+UI overhead**       | **~30–45 KB**                  |

Comfortably within the 180 KB initial-JS budget.

---

```
src/
  app/                  # Routes, providers, layouts
  components/
    ui/                 # shadcn/ui primitives (Button, Dialog, ...) — owned in-repo
    [feature components live under features/* not here]
  features/
    capture/            # Camera, photo crop, OCR trigger
    beans/              # List, detail, edit
    ratings/            # Add rating, ratings list
    analytics/          # Charts
    summary/            # Monthly summaries
    settings/           # Export, reset, about
    recommendations/
  services/
    db/                 # Dexie + migrations
    ai/                 # API clients (ocr, parse, search, scrape)
    queue/              # Offline AI task queue
    preferences/        # Derived prefs computation
    export/             # CSV + JSON
    photos/             # Resize, blob handling
  hooks/                # React hooks wrapping services
  types/                # Shared TS types (mirrors data-model.md)
  workers/              # Service worker entry, background workers
  utils/
  test/
    fixtures/
```

**Rules:**

- Components never call `fetch` directly — always via `services/ai/*`.
- Components never touch Dexie directly — always via hooks or `services/db/*`.
- All AI service calls go through the queue, even when online (queue auto-flushes).

---

## Image Pipeline

1. User captures via `<input type="file" accept="image/*" capture="environment">` (broadest compat) with a fallback `getUserMedia` capture screen for desktop.
2. Client resizes longest edge to **1600 px**, re-encodes to WebP quality 0.82 (fallback JPEG 0.85 on iOS Safari).
3. Generates a **160 px thumbnail** stored as data URL on the bean record.
4. Original (resized) blob stored in `photos` object store; bean keeps `photoId`.
5. Sent to BFF as base64 (single shot; no chunking needed under 8 MB).

Hard limits: max 5 photos per bean (1 bag + up to 4 cup photos); reject > 8 MB after resize.

---

## Offline-First Strategy

### Installing to a home screen

- The manifest's icons are listed once in `build-config/pwaIcons.ts` and shared
  by `vite.config.ts` and `build-config/pwaIcons.test.ts`, which asserts every
  referenced PNG exists at the size it claims. The manifest previously named
  three icons that had never been generated: it stayed valid JSON, so nothing
  failed, but Chromium would not offer to install the app and iOS used a
  screenshot of the page as the home-screen icon.
- The PNGs are rendered from `build-config/icons/*.svg` by
  `scripts/generate-icons.mjs` and **committed**. `sharp` is not a project
  dependency — it is a large platform-specific binary, and these files change
  only when the logo does.
- The maskable icon is a separate drawing, not the standard one re-tagged: a
  maskable icon is cropped to the platform's own shape and only its middle 80%
  survives.
- iOS ignores the manifest for both the icon and `display: standalone`. It needs
  `<link rel="apple-touch-icon">` and `apple-mobile-web-app-capable` in
  `index.html`, so those are asserted by the same test.

### Service Worker (Workbox)

- **Precache** app shell (JS/CSS/HTML, icons).
- **Runtime caching**:
  - `*.svg`, `*.png`, fonts → `CacheFirst`, 30 days.
  - `/api/*` → **NetworkOnly with background queue** (see below).
- App detects offline via `navigator.onLine` + heartbeat ping every 30s when relevant.

### AI Task Queue

The `pendingAiTasks` store IS the offline queue. Flow:

1. UI action enqueues a task and returns immediately.
2. A `QueueRunner` (single in-tab, lock via `navigator.locks`) drains tasks when online.
3. Backoff: `min(60s * 2^attempts, 1h)`; max 8 attempts then mark failed.
4. Failed tasks remain visible in **Settings → Pending operations** with retry/cancel.
5. Bean records show a "draft" badge while their seed task is unresolved.

### UX states per screen

Every screen renders explicit states: `loading`, `empty`, `error`, `offline`, `success`. See `ux-states.md`.

### Capture-while-offline UX

- Photo + manual fields can always be saved.
- OCR/LLM/scrape steps queue with friendly messages: "We'll fill in details when you're back online."
- User can edit or save the draft anyway.

---

## IndexedDB & Migrations

Library: **Dexie 4.x**. Database name: `coffee-app`. Current version: `1`.

Migration rules:

- Bump Dexie version on any store/index change.
- Each version supplies an `upgrade(tx)` function that mutates existing records to the new schema, including bumping `schemaVersion` on each row.
- A `meta.dbSchemaVersion` record gates app boot; if the on-disk schema is newer than the running app, show "Please refresh."
- Never silently drop user data; missing required fields → set `needsReview = true` and surface in UI.

Storage quotas: request `navigator.storage.persist()` after the first save; surface an "Insufficient space" warning if `estimate()` shows < 50 MB free.

---

## Security & Privacy

- **User data is local while signed out.** Signing in replicates records to Cosmos DB per user; see `specs/sync.md` and `SECURITY.md`. No analytics, no third-party SDKs.
- BFF logs request metadata only (timing, status, model name) — never OCR text, parsed JSON, or photos.
- BFF strips EXIF from incoming images before forwarding.
- **Every BFF endpoint that costs money to serve is rate limited per caller.** The token bucket lives in `api/src/lib/rateLimit.ts` and is applied over HTTP by `api/src/lib/rateLimitHttp.ts`; each endpoint gets its own bucket so an enrichment run — which legitimately calls search, then scrape, then parse for one coffee — cannot starve the others. Three budgets: `AI_RATE_LIMIT` for the model endpoints (`/api/parse`, `/api/ocr`, `/api/search`, `/api/recommend`), `FETCH_RATE_LIMIT` for the URL-fetching ones (`/api/scrape`, `/api/image`), and the much tighter `IMAGE_RATE_LIMIT` for `/api/studio-photo`, which generates a picture per call. Refusals are `429` with a `retry-after`. This is a **cost control, not a security control** — state is per Function instance and the principal header is unverified, but a forged identity only moves the caller to another bucket of the same size, so the ceiling holds. It is also the only thing that caps spend at the moment of the call: the Azure budgets in `infra/budget.bicep` alert after the fact and cannot stop a request.
- CSP: generated at build time by `build-config/csp.ts` and written into `staticwebapp.config.json`. `script-src` is `'self'` plus the sha256 of the inline theme script — no `'unsafe-inline'`; `img-src` allows `data:` and `blob:` for thumbnails and IndexedDB photos; `connect-src` is `'self'` plus the photo blob endpoint (and the BFF origin, when it is a separate one). Verified by `pnpm test:e2e:csp`, which runs a production build under the real header.
- Settings → **Reset** wipes IndexedDB, Cache Storage, and unregisters the service worker.
- Settings → **Export then delete** option encouraged before reset.
- Privacy notice page lists: where photos go (Azure Vision/OpenAI for processing only), what sync stores when signed in, and how to delete.

---

## Observability

- Client: lightweight in-app log ring buffer (last 200 events) viewable in Settings → Diagnostics. Not transmitted.
- BFF: Application Insights with sampling at 20%, custom metrics for per-endpoint latency and error rate. **No request bodies logged.**

---

## Performance Budgets

| Metric                                   | Target             |
| ---------------------------------------- | ------------------ |
| First contentful paint (mid-tier mobile) | < 1.8s             |
| Time to interactive                      | < 3.0s             |
| JS bundle (initial, gzipped)             | < 180 KB           |
| Photo capture → preview render           | < 500 ms           |
| OCR + parse end-to-end (online)          | < 6 s p50          |
| Bean list scroll                         | 60 fps to 1k items |

Lazy-load: analytics charts (Recharts), camera fallback module, scraper UI.

---

## Testing Strategy

- **Unit (Vitest)**: services (db, queue, preferences, export, photo), pure utilities.
- **Component (Testing Library)**: each feature folder has at least one happy-path render test.
- **Contract tests**: JSON-schema validation of AI service responses against `data-model.md` schemas.
- **E2E (Playwright)**: capture flow with a mocked BFF, offline mode, export round-trip.
- **AI mocking**: a `MockAiService` implementing the same interface, deterministic fixtures in `src/test/fixtures/ai/*.json`. Real-call tests are gated behind `RUN_AI_TESTS=1`.
- CI: lint, typecheck, unit + component, build, Playwright (against preview deployment).

---

## Browser Support

- **Tier 1 (full features)**: Chrome/Edge ≥ last 2 majors, Safari ≥ 17 (iOS + macOS), Firefox ≥ last 2 majors.
- **Tier 2 (degraded)**: Older Safari — no `getUserMedia` constraints, falls back to file-input capture.
- iOS PWA caveats explicitly handled: IndexedDB clearing on storage pressure (mitigated via `navigator.storage.persist()`), no background sync (queue runs only when tab is open).

---

## Future-Proofing Hooks

The following modules ship as no-op stubs in v1, but with stable interfaces:

- `services/auth/` — `AuthProvider` interface; v1 implementation is `LocalOnlyAuthProvider`.
- `services/sync/` — `SyncEngine` interface with `sync()`/`status()`/`reset()`; v1 = `NoopSyncEngine`.

The v2 design for both is fully specified in `sync.md`, including the storage topology, replication protocol, and delivery phases.

- `services/embeddings/` — `EmbeddingIndex` interface; v1 = `NoopEmbeddingIndex`.
- Cafe-drink tracking — schema reserves `Rating.location = 'cafe'` and `cafeName` already.
