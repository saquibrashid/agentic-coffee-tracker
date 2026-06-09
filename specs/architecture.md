# Architecture Specification

This document covers the system topology, secrets handling, network boundaries, offline strategy, storage internals, and migrations.

---

## High-level Topology

```
┌──────────────────────────────┐         ┌────────────────────────────┐
│  Browser (PWA)               │  HTTPS  │  BFF (Azure Functions)     │
│  React + TS + Vite           │ ──────▶ │  Node 20, Bicep-deployed   │
│  IndexedDB (Dexie)           │         │  /api/ocr, /api/parse,     │
│  Service Worker (Workbox)    │         │  /api/search, /api/scrape  │
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

| Concern        | Choice                                    | Notes                                |
|----------------|-------------------------------------------|--------------------------------------|
| Static hosting | **Azure Static Web Apps (Standard)**      | Built-in Functions integration       |
| API runtime    | Azure Functions (Node 20, consumption)    | Co-located with SWA                  |
| Auth (v1)      | None                                      | App is single-user, local-only       |
| Auth (v2)      | SWA built-in auth (Microsoft, Apple)      | Placeholder module from day 1        |
| IaC            | Bicep in `/infra`                         | `azd up` deployable                  |
| CI/CD          | GitHub Actions (provided by SWA template) | PR previews enabled                  |

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
Response: { parsed: <LLM Output schema>, model: string }
```
Implements structured-outputs + 1 retry. See `data-model.md` for schema.

### `POST /api/search`
```
Request:  { roaster: string, name: string, max?: number }
Response: { results: { url, title, snippet }[] }
```
Calls Bing Web Search v7. Cached server-side for 24h keyed by `(roaster|name)`.

### `POST /api/scrape`
```
Request:  { url: string }
Response: { extracted: <partial LLM Output schema>, sourceUrl: string }
```
Fetches, sanitizes HTML, runs LLM extraction with the same JSON schema. Allowlist of domains (roaster sites + known coffee retailers); deny-by-default for unknown domains in v1.

### `POST /api/recommend` (v1.5)
```
Request:  { preferences: UserPreferences, count?: number }
Response: { suggestions: { roaster, name, why, sourceUrl }[] }
```

---

## Secrets & Configuration

| Name                          | Where         | Notes                          |
|-------------------------------|---------------|--------------------------------|
| `AZURE_VISION_ENDPOINT`/`KEY` | Functions app | Stored in Key Vault reference  |
| `AZURE_OPENAI_ENDPOINT`/`KEY` | Functions app | Key Vault reference            |
| `AZURE_OPENAI_DEPLOYMENT`     | Functions app | Model deployment name          |
| `BING_SEARCH_KEY`             | Functions app | Key Vault reference            |
| `ALLOWED_ORIGINS`             | Functions app | Comma-separated; SWA hostname  |
| `VITE_API_BASE_URL`           | Client build  | Empty string in SWA (same-origin) |

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
      dialog.tsx
      ...
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
/* src/styles/globals.css (excerpt) */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 30 40% 98%;
    --foreground: 25 30% 15%;
    --primary: 25 60% 35%;       /* coffee brown */
    --primary-foreground: 30 40% 98%;
    --radius: 0.75rem;
    /* ...full shadcn token set... */
  }
  .dark {
    --background: 25 20% 10%;
    --foreground: 30 30% 95%;
    --primary: 28 70% 55%;
    /* ... */
  }
}
```

### Dark mode
- Class strategy (`darkMode: 'class'`).
- User pref stored in `meta` IndexedDB store; default = follow `prefers-color-scheme`.
- All shadcn components handle dark variants natively via the token set above.

### Rules
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
| Item | Size |
|---|---|
| Tailwind production CSS (typical) | 8–12 KB |
| Radix primitives (sum of used) | 15–25 KB |
| shadcn/ui generated TS | counted in your code, not deps |
| lucide-react (per icon used) | ~0.5–1.5 KB |
| `tailwind-merge` + `clsx` | ~3 KB |
| **Total style+UI overhead** | **~30–45 KB** |

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

- **All user data is local.** No analytics, no third-party SDKs in v1.
- BFF logs request metadata only (timing, status, model name) — never OCR text, parsed JSON, or photos.
- BFF strips EXIF from incoming images before forwarding.
- CSP: default-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://<bff-host>.
- Settings → **Reset** wipes IndexedDB, Cache Storage, and unregisters the service worker.
- Settings → **Export then delete** option encouraged before reset.
- Privacy notice page lists: where photos go (Azure Vision/OpenAI for processing only), retention (none, server-side), and how to delete.

---

## Observability

- Client: lightweight in-app log ring buffer (last 200 events) viewable in Settings → Diagnostics. Not transmitted.
- BFF: Application Insights with sampling at 20%, custom metrics for per-endpoint latency and error rate. **No request bodies logged.**

---

## Performance Budgets

| Metric                                   | Target            |
|------------------------------------------|-------------------|
| First contentful paint (mid-tier mobile) | < 1.8s            |
| Time to interactive                      | < 3.0s            |
| JS bundle (initial, gzipped)             | < 180 KB          |
| Photo capture → preview render           | < 500 ms          |
| OCR + parse end-to-end (online)          | < 6 s p50         |
| Bean list scroll                         | 60 fps to 1k items|

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
- `services/sync/` — `SyncEngine` interface with `push()`/`pull()`/`status()`; v1 = `NoopSyncEngine`.
- `services/embeddings/` — `EmbeddingIndex` interface; v1 = `NoopEmbeddingIndex`.
- Cafe-drink tracking — schema reserves `Rating.location = 'cafe'` and `cafeName` already.
