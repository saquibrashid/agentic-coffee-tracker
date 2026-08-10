# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
