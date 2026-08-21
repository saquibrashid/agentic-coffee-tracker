# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- **The Monthly summary screen is gone.** It reported all-time figures under
  the words “this month”: `generateMonthlySummary` called `computeAnalytics()`
  with no argument, which defaults to the `all` range, so only the storage key
  was ever monthly — regenerating in a new month produced identical numbers
  filed under a new date. Everything it did show, Analytics and For you already
  show correctly and in more detail, Analytics with a real 30-day range. The
  three things `specs/ui.md` actually asked of it — top beans, flavour trends,
  new insights — were never built. It was early scaffolding nothing came back
  to, and it was spending one of only seven bottom-nav slots to be wrong. The
  nav is now six items and correspondingly roomier.

### Fixed

- **Photos no longer show as broken images while their bytes are still
  arriving.** A coffee synced from another device — or opened in the
  home-screen app on an iPhone, which iOS gives storage of its own separate
  from Safari's — appeared with a broken-image icon instead of its picture.
  Sync copies a photo's details and its actual bytes over two different
  routes, so for a short while a photo exists as a record with nothing in it.
  The app was building an image out of those empty bytes and showing it, and
  because that counted as "a photo", it was preferred over the small preview
  image that was sitting there working perfectly well the whole time. The app
  now recognises a photo that has not finished arriving, shows the preview
  until it does, and swaps in the full picture once the bytes land.

- **You can change which Microsoft account the app uses.** Signing out and back
  in always returned to the same account with no chance to pick another, which
  left anyone who signed in with the wrong one — a work account instead of a
  personal one — stuck with it. `/.auth/logout` only clears this app's cookie;
  the Microsoft session outlives it and the next sign-in completes silently
  against it. There is no fix available at sign-in: measured against the live
  deployment, `/.auth/login/aad?prompt=select_account` has the `prompt` stripped
  before the request reaches Entra, because the pre-configured provider runs
  under Microsoft's own client id rather than one this deployment controls. The
  account menu now offers **Sign out and switch account**, which continues to
  Microsoft's sign-out endpoint so the next sign-in has no session to reuse.
  Because Entra will not return you here afterwards — it only redirects to a URL
  registered on its app registration, which is Microsoft's and not ours — the
  app says so before handing over rather than dropping you on a Microsoft page
  unannounced. Plain **Sign out** is unchanged for the ordinary case, and
  neither one touches the coffees stored on the device.

- **Looking up missing details now tells you what it did.** Pressing “Look up
  missing details” produced a queue that ran, deleted its own tasks and left no
  trace, so the count above the button still said the same four coffees were
  incomplete and nothing anywhere said why. Three separate paths in the queue
  all ended in the same silent delete — filled, found nothing new, and gave up
  permanently were indistinguishable — and the one status message lived in
  component state, so navigating down to the queue and back destroyed even
  that. Each lookup now records its outcome on the coffee itself, which
  survives navigation and reload, and Settings reports the tally for the run
  you started. A coffee whose product page could not be found is called out
  separately from one whose lookup broke, because the queue will never retry
  the former on its own and the fix is to edit the shortened name it was
  imported with.

- **The library shows which coffees are missing details.** Settings could say
  four coffees were incomplete while the library gave no way to tell which
  four: it badges coffees that need _review_, which is a different and only
  partly overlapping set. Cards now carry a badge naming the gaps — “Missing
  process and photo” — falling back to a count once the list would be wider
  than the card, and there is a “Missing details only” filter. The Settings
  count links straight to that filtered view.

- **A hung CI job can no longer burn hours of runner time.** A run of the build
  and test job stalled for three and a half hours before GitHub's six-hour
  default killed it; the culprit was the Playwright browser install, which
  fetches browser binaries and apt packages and so blocks on the network rather
  than failing. Every job now declares a `timeout-minutes` sized to roughly
  three times its observed runtime, and the browser install carries its own
  step-level timeout because it is the only step with that failure profile. The
  deploy workflow matters most here: it uses `cancel-in-progress: false`, so one
  hung deploy would have queued every later deploy behind it. A test parses the
  workflow files and fails if any job is missing a timeout, and pins the list of
  job names so it cannot pass by matching nothing.

- **The bottom navigation now stays at the bottom of the screen.** On a short
  page like Summary it sat directly under the content, halfway up the display,
  and on a long page like Home it sat at the bottom — so it appeared to jump as
  you moved between screens. The shell asked for `min-height: 100%`, which needs
  a parent with a definite height to resolve against; `html` and `body` set one
  but `#root` did not, so the rule was silently ignored and the shell was only
  ever as tall as its content. `position: sticky` could not compensate, because
  it pins an element only while its container outruns the viewport. The shell
  now measures against the dynamic viewport instead, which also tracks the
  mobile address bar collapsing, and the nav pads for the home-indicator safe
  area so its labels are not underneath it once the app is installed.

- **The app can be installed to an iPhone home screen.** It advertised itself as
  installable and never was: the manifest listed three icons —
  `pwa-192x192.png`, `pwa-512x512.png` and `apple-touch-icon.png` — that had
  never been generated and returned 404 in production. Nothing complained,
  because the manifest itself was valid and served, so the failure was entirely
  silent: Chromium quietly declined to offer installation, and iOS fell back to
  using a screenshot of the page as the icon. `.gitignore` was excluding
  `public/pwa-*.png` as "generated at build" when no build step ever generated
  them. The icons are now rendered from committed SVG sources by
  `scripts/generate-icons.mjs`, and a test fails if the manifest ever again
  names a file that is not there or claims a size the PNG does not have. iOS
  needs more than the manifest, so `index.html` gained the `apple-touch-icon`
  link and the `apple-mobile-web-app-capable` and title tags that make the
  shortcut open without browser chrome and under its own name.

- **A test failed at random because it typed a URL out one letter at a time.**
  `userEvent.type()` dispatches a separate keystroke per character, and each one
  costs a full React render plus a jsdom event — about 22ms here. The enrichment
  test typing a 62-character product URL therefore spent well over a second of
  its 5000ms budget on setup it was not asserting anything about, and under the
  parallel load of 85 test files that margin ran out. The affected tests now
  paste, which is one event no matter how long the text is and is also what a
  person actually does with a product URL. The five worst tests dropped 3–4×
  (1590ms to 385ms, 1304ms to 360ms), and the reasoning lives in a shared
  `pasteInto` helper so the next test to need it does not rediscover it. Raising
  the timeout was rejected: it would have hidden the cost rather than removed
  it, and left every future test paying it.

- **A test could fail the build after every test had already passed.** The
  capture tests rendered the add-coffee page without a router, then waited on
  the database writes — which land _before_ the page moves to its confirm step.
  The test resolved, the confirm step rendered afterwards, and its
  `useNavigate()` call threw into nobody's hands: an unattributed error printed
  below a green summary, on the runs where the timing happened to line up. The
  page is a route in the real app, so the bare render staged a situation that
  cannot occur in production. The tests now render inside a router and assert
  they reached the confirm step, which makes the step they were already
  triggering an intentional, awaited part of the test. Separately, a theme test
  claiming to cover "storage is unavailable" passed `undefined`, which is
  precisely the value that makes JavaScript apply the default argument — it had
  always exercised the default path and passed only while `localStorage`
  happened to be empty. It now passes `null`, and shared teardown clears storage
  so one test file's leftovers can no longer decide another file's result.

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

- **The BFF no longer holds a key for Azure OpenAI.** It authenticates with the
  Function App's user-assigned managed identity, which the template grants
  **Cognitive Services OpenAI User** scoped to the account — enough to call the
  deployments and nothing else, notably not enough to read the account keys. No
  key is generated into Key Vault, referenced from app settings, or fetched with
  `listKeys()`, so the secret that used to need rotating no longer exists.
  Bring-your-own accounts are unaffected: this deployment cannot grant itself a
  role on a resource it does not own, so supplying `openAiKey` keeps the previous
  `api-key` path exactly as it was, and that is also how local development runs.
  Which credential is in force is decided by whether the key is configured rather
  than by a separate switch that could disagree with it, and `GET /api/health`
  now reports the answer as `auth.openAi`. Closes the open question in
  `specs/agentic-backend.md` §9.

- **The coffee library has a place in the bottom navigation.** It is the app's
  central noun — every other tab is a view over it, and rating a coffee starts
  there — yet it was the one screen with no navigation entry, reachable only by
  spotting a link on Home, Analytics or For you. It takes the slot Settings
  held rather than becoming an eighth column, because seven labels already
  crowd a 390px phone and Settings is by far the least frequent destination in
  the set. Settings moves to the header beside the account control, where an
  app-wide, rarely-used destination is conventionally looked for. The
  navigation tests now assert that both the library and Settings are reachable
  from a screen that does not link to them.

- **The wizard's Back and Start over buttons no longer read as body text.** They
  sat flush against the last input with no divider and no border, so four
  controls in a row looked like more form, and Start over — the one that throws
  the entered coffee away — sat one mis-tap from Back. They stay inside the card,
  because actions belong with the form they act on and splitting navigation into
  a separate container would spread one decision across two. What changed is the
  hierarchy: a divider turns the row into a footer, matching the pattern the
  previous step already used; Back becomes an outline button; and Start over is
  pushed to the far end, quiet but no longer adjacent to the control people
  reach for by accident.

- **Predictions now recognise related coffees instead of demanding the exact
  same words.** Every attribute was matched by exact string, so a bag offering
  "green apple" from Kenya learned nothing from a shelf of coffees rated as
  "apple", "orchard fruit" and Ethiopian — and it was expensive twice over,
  because confidence multiplies by how many attribute kinds were recognised, so
  each unmatched word also cost a fifth of the confidence. That is why a real
  bag came back as 7.6/10 at 9% confidence next to a history that had plenty to
  say about it. Origins and tasting notes are open vocabulary, so they now fall
  back to curated families — East Africa, Apple & pear — pooled by how many
  ratings each value actually carries. Processing method needed no vocabulary
  at all, being a closed set the app defines, but it turned out to have the same
  shape as roast level before this: `washed → honey → natural → anaerobic` is a
  scale, not a set of unrelated labels, so a neighbour now stands in, discounted
  by distance. Family and neighbour matches are always discounted against exact
  ones and always say so in their wording — "you have not rated this origin,
  but East Africa coffees average…" — because related is not the same as
  identical. Values that genuinely sit off the scale, such as wet-hulled
  processing or a note nothing recognises, are still reported as unrated rather
  than filed under whatever happened to be nearest. Brazil is deliberately a
  family of one: a heavy nutty natural says little about a bright washed
  Colombian, and grouping them would manufacture evidence rather than find it.

- **"Will I like it?" is now a three-step wizard: Coffee, Details, Verdict.** It
  was always those three steps — bring in a coffee, confirm what it is, get an
  answer — but they were stacked on one page, which had two costs. The verdict
  rendered _below_ the details form, so on a phone the thing you came for
  arrived off-screen at the moment it appeared; and nothing said that filling in
  the form led anywhere, so it read as a chore rather than progress. The verdict
  now takes the screen to itself, with the score set large, the coffee named
  above it and the confidence drawn as a labelled gauge instead of a percentage
  buried in a caption. The gauge is coloured by confidence and never by the
  verdict, so a high score the predictor is barely sure of still looks like the
  shrug it is. Stepping back to adjust something keeps both what you typed and
  the answer already given, until an edit actually invalidates it.

- **Coffee scans now run on `gpt-5.4-mini`, at roughly a third of the cost.**
  The model behind parsing, recommendations and search had been `gpt-4o` since
  the app was built, chosen when every cheaper option failed for a concrete
  reason. Those reasons expired. Re-measured against the real prompt and schema
  on eight bag texts — label fragments, noisy OCR, a datasheet, a scraped
  product page and roaster prose — `gpt-5.4-mini` matches `gpt-4o` field for
  field (95.3%) while costing about $0.001 per scan instead of $0.0026, and
  answering roughly 20% faster on the one call you actually wait for. Nothing
  about the app changes except the bill and the wait. The comparison is kept in
  `scripts/model-eval/` so the next model is a re-run rather than a fresh
  argument, and `docs/deployment.md` now records why each rejected candidate was
  rejected — including `gpt-5.6-luna`, which is more accurate by half a point
  and rejects the `temperature` parameter every call sends.

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

- **“What to try next” now recommends coffees you can actually buy.** It used
  to suggest a _kind_ of coffee — “another Ethiopia natural” — because the model
  was explicitly told it had no catalog and forbidden from naming a roaster.
  Safe, and not much use: you could not click it, buy it, or check that it
  existed. Suggestions now come from a web search for real product pages, and
  the model that ranks them answers with a **candidate number, not a URL**, so
  it has nowhere to write an address it invented. It writes the roaster and
  coffee name for display, and those are checked back against the cited page's
  own title and domain before the pick is shown — the index proves the link is
  real, that check proves the label on it is. One roaster can fill at most two
  slots, so a single store's catalog cannot become the whole answer. Cards say
  “listed when we checked”, dated, rather than claiming stock the search never
  established, and when nothing verifiable turns up the page says so and falls
  back to the old style-level guidance instead of quietly looking the same.
  Set `GROUNDED_RECOMMEND_ENABLED=false` to switch the search off; the fallback
  is what you get.

- **You can send feedback from inside the app.** Every issue in this backlog
  existed because the author hit something himself and went to a terminal;
  anyone else had no route at all, and the reports most worth having — “the
  parse dropped my description”, “I got signed out again” — are exactly the
  ones nobody files if filing means finding the repository. Settings → Send
  feedback posts to a new `/api/feedback`, which files it as a GitHub issue
  labelled `feedback` + `needs-triage`, so triage is reading a labelled issue
  on the surface the backlog already lives on rather than a review queue that
  has to be built and then remembered. The reply links the issue that was
  created, because feedback sent into a void is assumed to have vanished.
  Because this repository is **public**, the panel says so above the button in
  ordinary type and lists every diagnostic before it is sent: app version,
  screen, installed-vs-browser, a short browser description, signed-in state
  and sync state. Identity is never attached — “signed in: yes” explains a sync
  bug and who does not — and neither is any coffee, rating or photo. The
  endpoint is rate limited and length capped, and an unconfigured deployment
  answers 503 and points the user at the issue tracker rather than accepting
  words it would then lose. `SECURITY.md` gains a row and the “no telemetry”
  claim is now qualified honestly. Closes #196.

- **Onboarding is now a set of hints that arrive when they are true, plus a
  walkthrough you can replay.** A first-launch tour was the obvious shape and
  the wrong one: it fires when the user has no data, so every feature has to be
  explained in the abstract against empty screens, it arrives before the user
  has any question it could answer, and dismissing it is usually permanent.
  Home instead shows at most one hint, gated on what the data says the user
  needs next — a countdown to the three ratings that switch recommendations on,
  then “For you” and “Check” once they will actually work, then assisted
  capture for someone who has only ever typed. Each stops being true once the
  user is past it, so a returning account with real history sees none of it
  without ever having dismissed anything, which is also what keeps a second
  device quiet: the conditions read synced data rather than a per-device “shown
  already” flag. The countdown deliberately does not repeat the hero’s “add a
  rating” — it adds the number the hero omits. Settings carries the same
  explanation as a permanent walkthrough with a “Show hints again” button, so a
  hurried dismissal is recoverable. Closes #241.

- **The predicted score is now drawn on the scale it lives on, with your own
  average marked on it.** A bare "7.3/10" reads as mediocre, which is why it
  could sit under a green "Probably yes" and look like the app arguing with
  itself. The verdict was never computed from the raw number — `verdictFor`
  reads the gap to your baseline, so the same 7.3 is a mild yes for someone who
  averages 7.0 and a warning for someone who averages 8.8. The bar makes that
  gap visible, which is the only thing about it worth drawing: a plain 0–10 bar
  would just restate the digits. It takes the verdict's colour and sits directly
  under the number so it cannot be confused with the confidence gauge below,
  which is coloured by confidence and means something else entirely. Toward
  `#236`.

- **A new user can now fill the app with a plausible library in one tap.** Every
  screen worth showing — Analytics, "For you", the predictor — needs a history
  before it says anything, so the first run of the app is a tour of empty
  states, which is the worst possible moment to explain what it is for. Settings
  now offers nine sample coffees and eighteen ratings that load into the real
  tables, so the features run for real rather than being mocked for a demo. The
  set is deliberately opinionated (bright washed and natural East Africans rated
  8.5–9.5, dark and roasty ones 3–4.5) so the charts show a shape rather than
  noise, and so the predictor has enough signal to reach a confident verdict.
  The samples never leave the device: `loadSampleData` deliberately does not
  enqueue to the outbox, which is the only thing sync reads from, so they are
  unsyncable by construction rather than by filter, and export strips them at
  the single point where all three exporters gather records. Home and Analytics
  carry a standing notice while samples are loaded, because the real risk is not
  loading them — it is forgetting you did and reading invented averages as your
  own taste. Toward `#241`.

- **The enrichment path now says what it is doing, in a vocabulary Foundry can
  read.** Every model call, tool call, and `/api/search` request emits an
  OpenTelemetry span in the GenAI semantic conventions, so questions we could
  previously only guess at — how often search finds nothing, which step spends
  the tokens, how much of the domain-guessing ladder is wasted — are now
  queries, with the KQL written down in `specs/observability.md`. That first
  number is the one `#208` needed and did not have: it recommended an agent
  fallback only where the pipeline fails, without knowing how often that is.
  Auto-instrumentation is deliberately off, so the volume stays proportional to
  what is being asked rather than to how hard the ladder worked, and expected
  failures (three of four guessed roaster domains do not exist) are recorded as
  outcomes on successful spans rather than as errors that would drown a
  failure-rate alert. Nothing is required to enable it in production — the
  Function App already has the connection string — and without one the spans
  are created and go nowhere.

- **An agentic enrichment path, measured against the pipeline and left switched
  off.** `POST /api/agent-enrich` (behind `AGENT_ENRICH_ENABLED`) lets the model
  choose the order of the enrichment steps instead of following the fixed
  fallback ladder, over the same tools and returning the same strict schema, so
  the client cannot tell the two apart. It works — 7/7 on the eval set, right
  page every time — but at 1.8× the tokens and 1.3× the p50 latency for the same
  accuracy, because on six of seven coffees it rediscovers the exact order the
  pipeline already hard-codes. The pipeline stays. The loop stays too, flagged
  off and costing nothing, because `scripts/agent-eval/` now makes the
  comparison repeatable for the next model or the next roaster that breaks the
  ladder. Full write-up in `specs/agentic-backend.md` §8.

- **Every AI endpoint now has a spending limit.** `/api/parse`, `/api/ocr`,
  `/api/search`, `/api/recommend`, `/api/scrape` and `/api/image` accepted
  unlimited requests, and each one either spends model tokens or fetches a
  remote page on our behalf. The token bucket already existed and already
  guarded sync and the studio photo endpoint — the other six simply never called
  it. They do now, each with its own budget, so an enrichment run that
  legitimately calls search, then scrape, then parse for a single coffee cannot
  exhaust itself a third of the way through. This is the piece the Azure budget
  alerts could not provide: a budget reports spending after it has happened,
  whereas a limit is the only thing that stops the request making it. `/api/scrape`
  and `/api/image` fetch a caller-supplied URL, so unlimited they were also a
  small open proxy. Refusals come back as `429` with a `retry-after`, which
  enrichment and sync already knew how to wait on.

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

- **Budget alerts on the Azure deployment.** Almost everything the template
  provisions is billed by use, and the metered parts are driven by whatever
  users happen to do, so a retry loop could spend for days before anyone
  thought to open the portal. There are now two consumption budgets: one over
  the whole resource group, and a tighter one filtered to the AI accounts,
  which is the only spend here with no ceiling of its own. Both alert at 50%,
  80% and 100% of actual and at 100% of forecast — the forecast alert being the
  only one that warns rather than reports. Nothing is provisioned until
  `BUDGET_CONTACT_EMAILS` names a destination, because a budget whose alerts go
  nowhere would be a protection the template claims but does not provide. Note
  that a budget alerts and does not cap; a real ceiling belongs in the
  application, as a quota that refuses the call before it is billed.

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
