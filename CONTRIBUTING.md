# Contributing

Thanks for considering a contribution to **Agentic Coffee Tracker**! 🎉

This project is in the early **specification phase**. Most contributions today are about refining specs, identifying gaps, or implementing the initial scaffold described in `specs/`.

---

## Code of Conduct

Participation in this project is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). By contributing you agree to uphold it.

## Specs come first

This project is **spec-driven**. Before writing code:

1. Read the relevant spec files in [`specs/`](./specs).
2. If your change conflicts with a spec, **update the spec first** in the same PR.
3. Spec precedence (resolve conflicts in this order):
   `data-model.md` → `architecture.md` → `ux-states.md` → `ui.md` → `ai.md` → `specs.md` → `copilot.md`.

## How to contribute

### Reporting bugs
Open an [issue](./.github/ISSUE_TEMPLATE/bug_report.md). Include reproduction steps, expected vs actual behavior, and environment.

### Suggesting features
Open a [feature request](./.github/ISSUE_TEMPLATE/feature_request.md). Reference the spec section it relates to.

### Submitting a pull request
1. Fork the repository and create a branch from `main`:
   `git checkout -b <kind>/<short-description>` where `<kind>` ∈ {`feat`, `fix`, `docs`, `chore`, `refactor`, `test`}.
2. Make your changes. Keep them focused — one logical change per PR.
3. Run the full check before pushing:
   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   ```
4. Open a PR using the [PR template](./.github/PULL_REQUEST_TEMPLATE.md).
5. Tick every item in the **UX state-handling checklist** for any UI change (see `specs/ux-states.md`).

## Coding standards

| Rule | Tool |
|---|---|
| TypeScript strict mode | `tsconfig.json` (`"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`) |
| Linting | ESLint + `eslint-plugin-jsx-a11y` + `eslint-plugin-react-hooks` |
| Formatting | Prettier (Tailwind plugin enabled) |
| Commit style | [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, …) |
| Branch naming | `<kind>/<short-description>` |
| Accessibility | WCAG 2.1 AA — verified by `axe-core` and a keyboard-only walkthrough |

### Architectural rules
- Components never call `fetch` directly — always via `services/ai/*`.
- Components never touch Dexie directly — always via hooks or `services/db/*`.
- All AI service calls go through the offline queue.
- Use only `@/components/ui/*` (shadcn) primitives — no second component library.
- Use only `lucide-react` for icons.
- No runtime CSS-in-JS.

## Testing

| Layer | Tool |
|---|---|
| Unit | Vitest |
| Component | Testing Library |
| E2E | Playwright |
| Accessibility | `@axe-core/react` (dev) + `@axe-core/playwright` (CI) |
| Contract | JSON-schema validation against `specs/data-model.md` |

New code without tests will be sent back for revision unless the change is purely documentation.

## Releasing

Maintainers only. We use semantic versioning once the project ships v0.1.

## Questions?

Open a [discussion](../../discussions) or ping a maintainer in an issue.
