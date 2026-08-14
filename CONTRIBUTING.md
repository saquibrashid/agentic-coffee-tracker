# Contributing

Thanks for considering a contribution to **Coffee Bean Tracker**! 🎉

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

| Rule                   | Tool                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| TypeScript strict mode | `tsconfig.json` (`"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`) |
| Linting                | ESLint + `eslint-plugin-jsx-a11y` + `eslint-plugin-react-hooks`                                              |
| Formatting             | Prettier (Tailwind plugin enabled)                                                                           |
| Commit style           | [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, …)                   |
| Branch naming          | `<kind>/<short-description>`                                                                                 |
| Accessibility          | WCAG 2.1 AA — verified by `axe-core` and a keyboard-only walkthrough                                         |

### TypeScript 6 and 7 side by side

`tsc` is **TypeScript 7** (the native Go port — roughly 3x faster here: a cold
`tsc -b --noEmit` drops from ~6.1s to ~2.0s).

TypeScript 7.0 ships without a programmatic API, and `typescript-eslint` refuses
to load against it outright ([typescript-eslint#10940][ts-eslint-7]). Per the
[TypeScript 7.0 announcement][ts7], both versions are installed side by side via
npm aliases in `package.json`:

```jsonc
"typescript": "npm:@typescript/typescript6@^6.0.2", // the API, used by typescript-eslint
"@typescript/native": "npm:typescript@^7.0.2"       // the fast `tsc` binary
```

So `npx tsc` is 7.x and `npx tsc6` is 6.x. Anything importing `typescript`
programmatically resolves to 6.x and keeps working.

**Do not "simplify" this to a single `typescript` dependency** — pointing it at
7.x breaks `pnpm lint` with `typescript-eslint does not support TS 7.0`. Once
typescript-eslint supports TS 7 (expected against the new 7.1 API), drop the
`@typescript/native` alias and set `typescript` back to `^7`.

[ts7]: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-60
[ts-eslint-7]: https://github.com/typescript-eslint/typescript-eslint/issues/10940

### Architectural rules

- Components never call `fetch` directly — always via `services/ai/*`.
- Components never touch Dexie directly — always via hooks or `services/db/*`.
- All AI service calls go through the offline queue.
- Use only `@/components/ui/*` (shadcn) primitives — no second component library.
- Use only `lucide-react` for icons.
- No runtime CSS-in-JS.

## Testing

| Layer         | Tool                                                  |
| ------------- | ----------------------------------------------------- |
| Unit          | Vitest                                                |
| Component     | Testing Library                                       |
| E2E           | Playwright                                            |
| Accessibility | `@axe-core/react` (dev) + `@axe-core/playwright` (CI) |
| Contract      | JSON-schema validation against `specs/data-model.md`  |

New code without tests will be sent back for revision unless the change is purely documentation.

## Releasing

Maintainers only. We use semantic versioning once the project ships v0.1.

## Questions?

Open a [discussion](../../discussions) or ping a maintainer in an issue.
