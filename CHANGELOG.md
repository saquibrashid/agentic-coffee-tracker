# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Analytics ranks by score, counts ratings, and admits what it is hiding.**
  The breakdown panels sorted by raw average, printed that average, and then
  drew the bar from something else entirely — the number of ratings — so every
  note on your single best coffee tied at the top with a full-length bar, and
  the bars contradicted the order they were in. Bars are now drawn from the
  score the list is sorted by, and that score is held back where few ratings
  stand behind it, using the same rule as the taste map on "For you" rather than
  arithmetic of its own; the two screens could previously order the same history
  differently and both look authoritative. Bars below your own average are drawn
  grey so the weak end of the list is visible rather than merely short. The bare
  number beside each score now says what it counts — ratings, not cups — and
  names how many different coffees they came from when that is fewer, because
  "9.0 from 6 ratings" reads like six coffees agreeing when it may be one coffee
  rated six times. Each panel showed a silent top slice and now says how many
  values it is holding back, with a control to show them all.

- **"Will I like it?" can tell two coffees apart again.** Asking about a dark
  roast and a light roast from the same roaster and origin returned the same
  score for both. Three things caused it. The estimate was being snapped onto the
  half-steps the rating form offers, so 7.4 and 7.7 both printed as 7.5 — a
  rating has to be a value you could pick, but an estimate does not. Whatever you
  drink most carried the largest weight of any attribute despite averaging, by
  definition, your overall average, so it dragged every verdict toward the middle;
  evidence is now weighted by how far an attribute actually distinguishes coffees,
  not merely by how often it appears. And a roast level you had never rated
  counted as nothing at all, even with plenty of history one step away on what is
  a scale rather than a set of unrelated labels; the nearest level now stands in,
  discounted by distance and labelled as the approximation it is. Confidence is
  additionally scaled by how much of the coffee was actually recognised, so a
  verdict resting on one attribute no longer looks as certain as one resting on
  five.

- **"Will I like it?" counts ratings, not cups.** Every explanation on the screen
  read "across 7 cups", but the number counts rating records: one bag rated twice
  is two of them however many cups were actually poured from it, and a bag rated
  once could be a fortnight's drinking. The unit overstated the history in one
  direction and understated the drinking in the other, so the wording now says
  what the arithmetic actually measures.

- **The taste map is ordered by how much you liked something, not how often you
  bought it.** The lists ranked each value by its average score multiplied by a
  term that grew with the number of ratings — a number never shown — so a note
  averaging 6.5 across eight ratings sat above one averaging 9.0 across two while
  the page displayed both scores side by side and appeared to sort them wrongly.
  Popularity can no longer promote something you rate below your own average.
  Values are now shrunk toward that average instead, which still hedges a single
  enthusiastic rating without letting volume overrule the score. The "Your current
  signature" sentence inherited the same fault and named leaders you rate poorly;
  it now only cites what genuinely runs above your average, and says nothing at
  all when nothing does. A new **Recurring disappointment** insight names what
  repeatedly lets you down, which the profile previously had no way to tell you.

- **Pasted and scraped descriptions are no longer thrown away.** Text you paste,
  a scraped product page and an imported PDF all go through the same extraction
  prompt, which described its input as OCR of a bag label and told the model not
  to guess. A roaster's several-paragraph story about a coffee therefore had no
  field to land in and came back empty, along with the tasting notes buried in
  it. The prompt now names the sources it actually receives and sends prose
  about the coffee to "From the roaster".

- **"Needs review" can now be answered.** The library badged a coffee as needing
  review, but its own page never mentioned the flag and nothing outside the
  photo-capture flow could clear it — and since accepting any web suggestion
  raises it, an imported coffee that was later enriched kept the badge for good
  with no way to act on it. The coffee's page now says which details are in
  question and offers a **Looks right** button that settles it.

- **Signing in and out no longer shows a 404.** The app is a single-page app, so
  its offline service worker answers navigations with the app itself and lets
  the router take over — correct for every route the app owns, and wrong for
  `/.auth/…`, which is not an app route at all but an endpoint Azure serves.
  Signing in navigates to `/.auth/login/aad` expecting a redirect to Microsoft;
  the service worker was answering with the app shell instead, so the router was
  handed an address it has no page for and showed an error while the sign-in
  endpoint was never reached. Sign-out failed identically, which was worse:
  someone who cannot sign out cannot hand over their device. Only `/api` had
  been excluded. Both are now left to the platform, with a test that keeps the
  list honest.

- **Coffees on storefronts that render in the browser no longer enrich to
  blank.** Scraping assumed the words were in the HTML. A storefront built as a
  single-page app sends a shell of script tags instead and assembles itself once
  JavaScript runs, so stripping the tags left _nothing at all_ — Blue Bottle's
  Night Light Decaf yielded zero characters, and pasting the address by hand
  failed for exactly the same reason. The details were never missing, only
  hidden: these sites serialise the page's state into a JSON block so the
  browser can carry on where the server left off, and reading that recovers the
  name, description, roast level, tasting notes and product photo. Standard
  schema.org markup is preferred where a page publishes it. Because a product
  page carries its recommendations in the same blob — sitting _ahead_ of the
  product itself — the coffee is identified first and read from on its own,
  rather than flattening the page and enriching a coffee with its neighbour's
  details. Pages that already scraped cleanly are untouched: this is only
  consulted when the markup yields nothing.

- **Coffees whose roaster the model does not recognise can now be found.** Every
  lookup starts by working out where the roaster sells, and that was left
  entirely to the language model — which answers from recognition, so it goes
  quiet on smaller roasters and, less obviously, on spellings it has not seen.
  Asked about "High Wire Coffee Roasters" it returned nothing usable, even
  though the coffee sits on `highwirecoffee.com` and that store answers for
  every form of the query. The name itself is a strong clue, so candidate
  domains are now also derived from it directly — trade words such as "Coffee"
  and "Roasters" dropped or folded in the handful of ways roasters actually
  build their domains. Checked against real roasters, this alone places most of
  them without the model recognising anything, and a wrong candidate costs a
  single request that returns nothing.

- **Coffees with shortened names can now be found on the roaster's store.** A
  store's product search requires _every_ word of the query to match, so one
  abbreviation sank the whole lookup: "Holler Mtn." returned nothing from
  Stumptown, while "Holler Mountain" — and even bare "Holler" — return the
  coffee. Since a ratings spreadsheet is full of abbreviations, a large share of
  an import could not be enriched at all. The search now works down a ladder of
  progressively looser queries: the name as written, then with abbreviations
  expanded, then without packaging words ("whole bean", "ground"), then dropping
  trailing words. Because a looser query also drags in coffees that merely share
  a word, every result is scored back against the name the user actually wrote —
  so "Holler Mountain" wins, "Ground Holler Mountain" ranks below it, and an
  unrelated "Homestead" is discarded rather than silently applied.

- **Adding one coffee now looks it up on the web, like a bulk import already
  did.** A CSV import has always queued a `web-enrich` task for rows with gaps
  in them; adding a single coffee never did — so scanning a bag was the _worse_
  path for metadata, because a bag only carries what the roaster chose to print
  on it. Roast level and process were the visible casualties, sitting at
  "unknown" for coffees whose own product page states them plainly. The lookup
  is queued when the coffee is saved rather than when it is captured: by then
  the user has said which gaps are real, a discarded draft costs nothing, and
  the task is durable so it still runs after being offline.
- **Discarding a draft no longer throws.** `pendingAiTasks.beanId` was never
  indexed, and Dexie rejects `where()` on an unindexed keypath outright, so
  discarding raised a `SchemaError` _after_ the coffee had already been deleted
  — leaving the user on a form for a record that no longer existed. Added as
  Dexie **v4** (additive; no data is rewritten).
- **"Espresso Blend" and "Espresso Roast" now infer a medium-dark roast.** The
  ratings importer already mapped an explicit `roast: espresso` column to
  medium-dark, while text inference refused the word entirely — the same word
  resolving one way from a spreadsheet and another from a bag. Only the compound
  product-name forms count; a bare "great as espresso" still infers nothing,
  because it names a brew method and specialty roasters routinely serve espresso
  light. A stated roast ("Light Roast Espresso Blend") still wins outright.

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

- **A coffee's page is now four cards, and its tools stay out of the way.** The
  page was one long card with six headings in it, most of them forms: an
  enrichment panel, a photo panel and a rating form, all permanently open, all
  below the coffee itself. On a phone that ran to about three screens, of which
  roughly half was forms nobody had asked for. The coffee and its ratings now
  sit in cards of their own and stay open; **Details from the web** and
  **Photo** fold away behind a summary line that says what is inside, and
  **Add rating** opens the form only when it is wanted. A freshly imported
  coffee no longer prints a row of em dashes for the four things it does not
  know — it says so once, and points at the tool that fills them in.
- **Dark mode's cards look like cards.** A card sat four points of lightness
  above the page, the same step light mode uses — but light mode also gets a
  pure white surface against a tinted page and a drop shadow that actually
  lands on it, and neither of those works on a dark background. The step is
  eight points now, the border is stronger, and the surfaces painted on top of
  a card moved up with it so a muted badge does not vanish into it.
  `--destructive` was lightened to stay readable as text on the lighter card,
  and `src/styles/contrast.test.ts` now pins the separation instead of
  accepting anything above 1.05:1.

- **A coffee's page now leads with the coffee.** Opening one put the web
  enrichment and photo forms directly under the name, pushing the score, the
  ratings and half the attributes off the screen — so the page opened on its
  own controls rather than on what it is about. Details come first now: the
  photo, name, roaster and score together at the top, then attributes, then the
  ratings. Everything that changes the coffee is gathered under **Make
  changes** at the bottom, including adding a rating and removing the coffee.

  Removing a coffee was a red button beside the title, one mis-tap from the name
  someone was reading. It now sits at the end, with the other actions.

- **A coffee's page has a way back.** The library is not in the bottom bar, so
  the only way off this page was Home — which is rarely where anyone came from.
  There is now a back link that returns you where you were, and which names the
  library instead when the page was opened directly from a bookmark, a reload or
  a shared link, where there is no history to go back through.

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

- **"Will I like it?" names the coffee and shows its picture.** Checking several
  coffees from the same roaster in a row produced a run of verdict cards that
  looked identical, with nothing on them to say which coffee was being answered.
  The card is now titled with the coffee's own name and roaster, and a name read
  off a bag or a product page is kept rather than discarded. The name is a label
  and nothing more — it is never fed into the estimate, because a product name is
  marketing copy carrying no signal about taste, and on its own it will not
  enable the button. Checking by link also shows the coffee's picture now, as
  checking by photo always did, so the two ways in look alike; nothing is saved
  to your library either way.

- **Paste an image to add or check a coffee.** A screenshot of a product page is
  usually the fastest thing to hand, and both screens made you save it to disk
  and then find it again. Ctrl+V (⌘V) on either screen now reads the image
  straight from the clipboard. A paste carrying no image is left alone, so
  pasting a link into the link field still works.

- **"Will I like it?" can now take a photo.** Adding a coffee had an in-app
  camera; checking one only had a file picker marked `capture="environment"`,
  which on iOS Safari opens the camera but removes the "Photo Library" choice
  and on a desktop does nothing at all — so the screen you use standing in a
  shop was the one that could not use a webcam and could not use an existing
  photo. Both screens now offer the same camera, file picker and paste. Nothing
  is saved to your library from a check, as before.

- **Home shows the bag.** The library has led with each coffee's photo for a
  while; home's recent list was still text alone, so the two grids of the same
  coffees looked unrelated and the one you land on first was the harder to scan.
  A coffee with no photo keeps a placeholder tile so the titles stay in line.

- **Coffees are now found on roasters who don't run Shopify.** Looking a coffee
  up asked the roaster's own store for it, which is free and works for most
  roasters — but only because most run Shopify and expose a search endpoint. A
  roaster who doesn't was invisible no matter how well the domain was guessed,
  so Blue Bottle's Night Light Decaf came back with nothing while its product
  page sat in plain sight. A general web search now runs when the store search
  finds nothing, and it has no such blind spot.

  It reads only the pages the search actually returned, never a URL the model
  wrote: asked for addresses directly, a model invents plausible ones that 404.
  Results are scored against the coffee's name exactly as store results are, and
  a near miss — a category page, or a different coffee by the same roaster — is
  discarded rather than ranked last, because unattended enrichment takes the top
  result without asking anyone.

  Coffees already imported reach it through **Settings → Look up missing
  details**. The search only runs after the free path has failed, and can be
  switched off with `WEB_SEARCH_ENABLED=false`.

- **Give a coffee its details from text or a PDF, when it has no page at all.**
  Pasting a product address still assumes there is a page to point at. Some
  coffees have none — a roaster with no storefront, a subscription insert, a
  card in the box — and no improvement to the search could ever reach them. The
  enrichment panel now also takes text pasted straight in, or a PDF, and offers
  the same review-and-choose list as a scraped page: nothing is written without
  being ticked. A PDF written by software is read directly; one that is a scan
  or a phone photo has no text in it at all and is quietly rendered and sent
  through the same reader used for a bag photo. Details supplied this way leave
  the coffee's recorded source alone rather than blanking it, since there is no
  address to claim. The PDF reader is fetched only when a PDF is actually
  opened, so it costs nothing to anyone who never uses it.

- **Add your own photo to a coffee you already have.** A coffee only got a
  picture if enrichment found its page, so an import full of coffees that were
  never matched had no pictures and no way to get any — while the bags were
  sitting on the shelf the whole time. Each coffee's page now offers to take a
  photo with the camera or choose one off the device, whether or not it has one
  already. Your photo always wins: enrichment weighs an automatically found
  image against the existing one and refuses a worse one, but a picture you
  chose yourself is not a guess to be second-guessed. Replacing a photo removes
  the one it supersedes, and only after the coffee points at the new one, so a
  failure part-way leaves the picture that was there rather than none.

- **Paste a product page address to enrich a coffee.** Automatic lookup finds a
  coffee by working out where its roaster sells online, so it can only ever
  reach roasters it manages to place — one selling through a platform it does
  not understand is invisible to it, no matter how the search is improved. The
  enrichment panel now takes a pasted address directly, skipping the search and
  going straight to reading the page. It is offered up front and again when a
  search comes back empty, so anyone who has already found the coffee in another
  tab is never stuck: it is the one path that works for every coffee.

- **"Look up missing details" in Settings.** A lookup that finds no product page
  is deliberately dropped rather than retried forever, which left every coffee
  that failed under the old, stricter search stranded — nothing would ever try
  it again. This queues a fresh lookup for every coffee still missing a roast
  level, process, origin, notes or photo, skipping ones already queued, so an
  import that was written off can be picked up in one press instead of one
  coffee at a time.

- **Take a photo inside the app.** Adding a coffee now offers a live camera
  preview with a shutter button, instead of handing off to the OS file picker.
  The previous `capture="environment"` hint was a delegation that behaved
  differently everywhere: it opened the camera on Android, opened the camera on
  iOS but removed the "Photo Library" option, and was silently ignored on
  desktop — so a laptop webcam could not be used at all. The button appears only
  where a camera can actually be opened, permission denial and missing hardware
  are explained specifically rather than dead-ending, and the stream is released
  on capture, on cancel, and on unmount. Captured frames rejoin the existing
  photo pipeline, so resize, offline queueing, and OCR are unchanged. The file
  input remains for choosing an existing image and no longer suppresses the
  photo library on iOS.

- **Roast level inferred from text.** Most roasters never publish a labelled
  roast level, and a ratings export has no roast column at all, so imported
  coffees landed as `unknown` — contributing nothing to the preference profile.
  A deterministic pass now reads the roast out of explicit roast vocabulary
  ("French roast", "blonde", "full city") in the coffee name, roaster
  description, and tasting notes. It applies everywhere a coffee is created or
  looked up: adding by link, adding by photo, the background OCR queue, the
  enrichment review, CSV import, and an offline backfill over beans already in
  the library.
  It reads only explicit roast terms, never flavour words: "dark chocolate" and
  "light body" describe the cup, not the roast, and guessing from them would
  quietly poison recommendations. Negations ("not your typical dark roast") are
  skipped, and a roast the user set by hand is never overwritten.

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
