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
- Bean library (`/beans`): browse, search, filter (roast / process / needs-review / archived) and sort
- Web enrichment: `/api/search` + `/api/scrape` surfaced as an opt-in field diff on Bean Detail, plus import-from-URL on the capture page

## 🟡 Next up

| #                                                                         | Issue                              | Notes                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#15](https://github.com/saquibrashid/agentic-coffee-tracker/issues/15)   | Azure smoke + Application Insights | IaC and probes are in place; needs a real subscription to execute                                                                                                                                                                                                                                                                  |
| —                                                                         | Request persistent storage         | `specs/architecture.md` §Storage quotas requires `navigator.storage.persist()` after the first save; not implemented. Without it the browser may evict IndexedDB under disk pressure. Surface an "Insufficient space" warning when `estimate()` shows < 50 MB free.                                                                |
| —                                                                         | Multi-device sync (v2)             | Specced end-to-end in `specs/sync.md`. **Phases 0–6 are shipped**: SWA auth, Cosmos, `seq`-cursor pull/push, last-write-wins merge, local outbox, the live `CloudSyncEngine`, and photo bytes to Blob Storage with a 500 MB per-user quota. Remaining: phase 7 (sync UI and server-side delete), phase 8 (hardening, two-device E2E). |
| [#111](https://github.com/saquibrashid/agentic-coffee-tracker/issues/111) | Professional UI + coffee aesthetic | Type scale and a real typeface, fill out `components/ui` so form controls stop being styled inline, elevation/density pass, distinctive empty states. Palette is already coffee-themed — the gap is type, component coverage and detail.                                                                                           |
| [#110](https://github.com/saquibrashid/agentic-coffee-tracker/issues/110) | Dark mode, deep brown              | The `.dark` tokens exist but nothing ever applies the class, so dark mode has never rendered. Wire up the `prefers-color-scheme` default `architecture.md` §Theming already specifies, then re-cut the background from near-black (`25 20% 9%`) to a genuine deep brown.                                                           |
| [#109](https://github.com/saquibrashid/agentic-coffee-tracker/issues/109) | Bean library: more filters         | Sort plus search/roast/process already exist. Add roaster, origin, rating range, varietal, freshness and decaf — deriving options from the data rather than a constant, since those fields are free text.                                                                                                                          |

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
