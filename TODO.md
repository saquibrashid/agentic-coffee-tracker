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

## 🟡 Next up

| # | Issue | Notes |
|---|-------|-------|
| [#15](https://github.com/saquibrashid/agentic-coffee-tracker/issues/15) | Azure smoke + Application Insights | IaC and probes are in place; needs a real subscription to execute |

## 💡 Ideas (not yet issues)

- Voice capture (`EntrySource = 'voice'`)
- Barcode capture
- Sync engine (multi-device) — architecture deferred to v2
- Background sync via Web Push for queued AI tasks
- Localized number/date formatting and i18n

## 📌 Workflow

1. Pick an open issue and assign yourself.
2. Branch: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`.
3. PR closes the issue: `Closes #N`.
4. CI must be green (lint, typecheck, build, unit, Playwright, a11y).
5. Squash-merge into `main`; branch protection enforced.
