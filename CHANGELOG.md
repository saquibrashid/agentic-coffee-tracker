# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **The sync engine's lazy import now actually defers anything** (#137). The
  entry chunk imported the status hook, the status hook imported
  `getSyncEngine()`, and so the whole Cosmos-facing engine — the Dexie outbox,
  the API client, the photo uploader — shipped in the initial bundle despite
  `App.tsx` importing it dynamically. Rollup never warned; Rolldown does. Sync
  status now lives in its own store that both the shell and the engine import,
  leaving the engine behind the dynamic import: **entry chunk 154.24 → 138.53
  kB (51.20 → 45.96 kB gzip)**, and a test asserts the module graph so the
  regression cannot return unnoticed.

- **Signed-out visitors no longer trigger `POST /api/sync/pull -> 401`.** The
  sync engine started on page load and only checked whether auth was
  _available_ in the build, not whether anyone was actually signed in. The 401
  that followed is classified as terminal — correctly, for a real session
  expiry — so the engine halted and the app showed a permanent sync error to a
  visitor who had never signed in, and who would then have to reload after
  signing in before sync did anything. Each cycle now checks for a current user
  first and stays idle when there is none.

### Changed

- **`SYNC_RECORD_QUOTA` is now actually configurable.** The API read the
  variable and `SECURITY.md` documented it as the way to raise the record
  ceiling, but nothing in `infra/` or `deploy.yml` ever set it, so the 20,000
  default was effectively hard-coded. Wired through the same path as
  `SYNC_ALLOWLIST` — repository variable → azd parameter → app setting — and
  documented alongside the 500 MB photo cap. Declared as a string rather than
  an `int` so an unparseable value falls back to the default, which is what the
  API already does, instead of failing the deploy.
- **Dropped `@radix-ui/react-dialog`**, which was declared but never imported —
  `confirm-dialog.tsx` uses the native `<dialog>` element. Also removed the
  accordion keyframes left behind by shadcn scaffolding: they animate to
  `--radix-accordion-content-height`, a variable only the Radix accordion sets,
  and that primitive is not installed.

- **Vite 8**: replaces Rollup with Rolldown and esbuild with Oxc. The object
  form of `build.rollupOptions.output.manualChunks` is gone; chunking now goes
  through `rolldownOptions.output.codeSplitting.groups` with
  `includeDependenciesRecursively` to preserve the "package plus its private
  dependency subtree" grouping the object form did implicitly. Output is
  slightly smaller overall and build time drops from ~9.6s to ~1.4s.
- **Dependency batch**: recharts 2 → 3, tailwind-merge 2 → 3, globals 15 → 17,
  `@radix-ui/react-slot` 1.2 → 1.3, prettier 3.8 → 3.9, typescript-eslint
  8.65 → 8.66, plus `@axe-core/playwright` and `@testing-library/user-event`.
  The three majors were checked against their migration guides rather than
  trusted to a green build: recharts 3 removes `activeIndex`, `alwaysShow`,
  `blendStroke` and friends (none used here — the app draws one default
  `BarChart`); tailwind-merge 3 requires Tailwind v4, which was already in
  place, and leaves plain `twMerge` untouched; globals 17 moves the
  AudioWorklet names out of `globals.browser`, which this config does not use.
  Prettier 3.9 reformats short unions onto one line, which is the bulk of the
  diff.

### Added

- **Content Security Policy.** `SECURITY.md` and `specs/architecture.md` both
  described a policy that no code emitted; the app shipped with no CSP at all.
  It is now generated at build time and written into
  `staticwebapp.config.json`, because two of its values cannot be hard-coded:
  the sha256 of the inline anti-FOUC theme script (which changes whenever that
  script is edited) and the photo storage account name (per-environment). No
  `'unsafe-inline'` for scripts or styles. Verified by `pnpm test:e2e:csp`,
  which serves a production build under the real header and fails on any
  violation — now a required CI check.

- **Analytics chart test** (`e2e/analytics.spec.ts`): the app's only recharts
  surface had no test that rendered it with data — every route that reached
  `/analytics` did so with an empty store, where a healthy chart and a broken
  one both draw nothing. The test now seeds ratings and asserts three bars
  exist with a non-zero measured height, which is what a charting library
  major version can actually break.

- **Sync phase 8, part two — the two-device test** (`specs/sync.md` → Testing):
  an end-to-end test driving two independent browser contexts — separate
  IndexedDB, separate Web Locks namespace, separate engine instance — against
  one shared account, covering propagation, conflicting edits converging on
  both sides, deletes, an older edit arriving last and losing, and a change made
  offline converging once the device reconnects. It runs in CI as a required
  check. Two client-only rules are now pinned by tests rather than by argument:
  a `507` from a full partition is terminal, not a transient error to retry
  forever, and cross-account isolation holds against a forged principal header.
- **Sync phase 8, part one — limits** (`specs/sync.md` → Delivery phases): a
  per-user request budget on every `/api/sync/*` endpoint and a 20,000-record
  ceiling per account, closing the "no bound on record storage" gap
  `SECURITY.md` had recorded. The record count rides on the cursor document
  inside push's existing transactional batch, so it costs no extra RU and
  cannot drift from the writes it counts. `SECURITY.md` gains a plain-language
  "What is stored, and where" table.
- **Professional UI pass** (#111): Fraunces as a self-hosted, latin-subset
  variable display face for headings; a real `components/ui` set (`Input`,
  `Select`, `Textarea`, `Label`, `Badge`, `CheckboxField`, `EmptyState`,
  `RoastScale`) replacing the class string that had been copied to nine call
  sites; an elevation and density pass on `Card`; distinctive empty states; a
  zero-byte CSS kraft grain; and roast level rendered as a five-step colour
  scale rather than a word.

  Two accessibility bugs surfaced during the pass and are fixed here: every
  hand-styled control in the app was 40px tall against the 44px minimum
  `specs/ux-states.md` requires, and `--destructive` used as text failed AA in
  dark mode once card titles were no longer large text. `@radix-ui/react-label`
  is now actually used; `@radix-ui/react-dropdown-menu` and
  `@radix-ui/react-toast` were dependencies with no importer and were dropped.

- **Bean library filters** (#109): roaster, origin and varietal multi-selects
  whose options and counts are derived from the beans themselves rather than a
  constant list, plus minimum rating and roast-date freshness. The controls sit
  behind a collapsed `<details>` disclosure carrying a badge with the number of
  active constraints, so the list stays above the fold on a phone. Rating and
  freshness exclude beans missing the field, stated in the UI rather than left
  implicit.
- **Project scaffold**: Vite + React 18 + TypeScript, Tailwind CSS theme tokens,
  shadcn-style `Button`/`Card`/`Skeleton` primitives, `lucide-react` icons,
  React Router shell with bottom nav, offline banner, PWA manifest via
  `vite-plugin-pwa`.
- **Storage**: Dexie 4 database (`coffee-app`) with all stores from
  `specs/data-model.md`.
- **AI client**: typed `services/ai/*` wrappers for `/api/ocr`, `/api/parse`,
  `/api/search`, `/api/scrape`.
- **Feature stubs**: Home, Add Coffee, Bean Detail, Analytics, Summary, Settings.
- **Azure Functions BFF** (`/api`): v4 programming model, TypeScript, 4 endpoint
  stubs (ocr/parse/search/scrape) returning 501 until wired to upstream services.
- **Tooling**: ESLint 9 (typescript-eslint, jsx-a11y, react-hooks),
  Prettier + Tailwind plugin, Vitest + Testing Library + jsdom,
  Playwright (Chromium + iPhone 14), strict TS with
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **pnpm workspace** linking root client and `api/`.
- **Initial spec set**: `specs/specs.md`, `specs/ui.md`, `specs/ai.md`,
  `specs/copilot.md`, `specs/data-model.md`, `specs/architecture.md`,
  `specs/ux-states.md`.
- **Repository collateral**: README, LICENSE (MIT), CONTRIBUTING,
  CODE_OF_CONDUCT, SECURITY, CHANGELOG, .editorconfig, .gitattributes,
  .gitignore, PR template, issue templates, Dependabot config, CI workflow,
  VS Code recommendations.
