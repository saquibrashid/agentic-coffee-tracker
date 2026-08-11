# Roadmap & TODO

High-level roadmap for the Agentic Coffee Tracker. Detailed work items live in [GitHub Issues](https://github.com/saquibrashid/agentic-coffee-tracker/issues); this file is the at-a-glance view.

## ✅ Done

- Project scaffold (Vite + React + TS, Tailwind + shadcn, Azure Functions BFF, PWA)
- Specs: data model, architecture, UX states, AI contract
- Capture flow: photo → resize + thumbnail + EXIF strip → Dexie persist
- Offline AI queue (`QueueRunner` with `navigator.locks`, exponential backoff)
- BFF endpoints with mock fallback and real Azure wiring (Vision / OpenAI / Bing)
- Ratings CRUD on Bean Detail
- Analytics (top roasters/flavors, score histogram) — Recharts
- Monthly summary (narrative + highlights, persisted)
- Export (CSV / JSON / JSON+photos)
- Settings: pending operations UI (retry / cancel / run-now)
- CI: lint, typecheck, build, Vitest, Playwright (chromium + webkit), axe a11y sweep, Bicep lint, Lighthouse budgets
- Docs: README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, CHANGELOG, issue & PR templates
- Recommendations engine (`/for-you`) — anonymous preference summary → grounded LLM suggestions
- `/api/parse` output validated against the JSON schema server-side; 422 on violation
- Deployment: azd + Bicep (SWA, Flex Consumption Functions, Key Vault, App Insights), OIDC deploy workflow, `/api/health`
- Route-level code splitting; Lighthouse perf/a11y budgets enforced in CI
- Strict TypeScript across the whole repo (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) and no `any` in application code
- Settings: storage usage + **Delete all data** (IndexedDB, Cache Storage, service worker) behind a typed confirmation
- Bean library (`/beans`): browse, search, sort, and filter by roast, process, roaster, origin, varietal, minimum rating, roast-date freshness, needs-review and archived — free-text facets derived from the data, behind a collapsed disclosure with an active count
- Dark mode: three-way System / Light / Dark in Settings, applied before first paint, on a deep roasted-brown palette whose contrast is asserted in `src/styles/contrast.test.ts`
- UI: Fraunces display face (self-hosted, latin subset), a full `components/ui` primitive set, elevation/density pass, distinctive empty states, CSS kraft grain, and roast level as a five-step colour scale
- Web enrichment: `/api/search` + `/api/scrape` surfaced as an opt-in field diff on Bean Detail, plus import-from-URL on the capture page

## 🟡 Next up

| #                                                                         | Issue                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#15](https://github.com/saquibrashid/agentic-coffee-tracker/issues/15)   | Azure smoke + Application Insights | IaC and probes are in place; needs a real subscription to execute                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| —                                                                         | Request persistent storage         | `specs/architecture.md` §Storage quotas requires `navigator.storage.persist()` after the first save; not implemented. Without it the browser may evict IndexedDB under disk pressure. Surface an "Insufficient space" warning when `estimate()` shows < 50 MB free.                                                                                                                                                                                                                                                 |
| —                                                                         | Multi-device sync (v2)             | Specced end-to-end in `specs/sync.md`. **Phases 0–7 are shipped**: SWA auth, Cosmos, `seq`-cursor pull/push, last-write-wins merge, local outbox, the live `CloudSyncEngine`, photo bytes to Blob Storage with a 500 MB per-user quota, and the Settings sync UI with server-side delete. Remaining: phase 8. Its limits half is shipped — a per-user rate limit and a 20,000-record quota, with `SECURITY.md` rewritten to match. What is left is the two-device Playwright test that actually proves convergence. |
| [#111](https://github.com/saquibrashid/agentic-coffee-tracker/issues/111) | Bean-photo art direction           | The UI pass is shipped. What is left is the part that needs real photos: bag images are the most colourful thing on screen and are currently rendered as a plain 56px square. Worth a proper aspect-ratio treatment and a blur-up placeholder once there is a library of real shots to look at.                                                                                                                                                                                                                     |
| [#109](https://github.com/saquibrashid/agentic-coffee-tracker/issues/109) | Decaf filter                       | The rest of #109 is shipped. Decaf is the one requested filter that could not be built: `CoffeeBean` has no such field, so it needs a schema bump, a capture-form control and an extraction-prompt change before it can be filtered on.                                                                                                                                                                                                                                                                             |

## 💡 Ideas (not yet issues)

- Voice capture (`EntrySource = 'voice'`)
- Barcode capture
- Background sync via Web Push for queued AI tasks
- Localized number/date formatting and i18n

## 📌 Workflow

1. Pick an open issue and assign yourself.
2. Branch: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`.
3. PR closes the issue: `Closes #N`.
4. CI must be green (lint, typecheck, build, unit, Playwright, a11y).
5. Squash-merge into `main`; branch protection enforced.
