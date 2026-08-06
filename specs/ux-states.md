# UX States Specification

Every screen MUST explicitly handle five states: **loading**, **empty**, **error**, **offline**, **success**. This document defines the contract per screen plus global patterns.

---

## Global Patterns

### Toasts
- Success: 3s auto-dismiss, top-center, green check.
- Error: persistent until dismissed, with "Retry" or "Details" action.
- Info (offline queue): 5s, neutral, includes count of queued items.

### Offline indicator
- Persistent thin banner under the app bar when `navigator.onLine === false`:
  > **Offline.** New entries will sync details when you reconnect.

### Pending-operation badge
- Settings icon shows a dot when `pendingAiTasks` count > 0.
- Bean cards show a "Draft" chip while their seed task is unresolved.

### Loading skeletons
- Use shimmer skeletons matching the final layout, not spinners, except for actions < 1s (use button spinner).

### Error boundary
- Wrap each route. Fallback UI:
  - Friendly message
  - "Reload" button
  - "Copy diagnostics" (last 50 log entries) — never includes user data
  - "Reset app" (links to Settings → Reset)

### Confirmations
- Destructive actions (delete bean, delete rating, reset app) require a confirm dialog with the bean/rating name typed in for reset.

### Accessibility (applies to all screens)
- WCAG 2.1 AA contrast.
- All interactive elements reachable by keyboard with visible focus ring.
- Form inputs labeled; errors announced via `aria-live="polite"`.
- Photos have alt text: `"{roaster} {name} bag photo"`.
- Charts have a "View as table" toggle.
- Touch targets ≥ 44×44 px.

---

## 1. Home

| State    | UI                                                                                  |
|----------|-------------------------------------------------------------------------------------|
| Loading  | Skeletons for: greeting card, recent timeline (3), recommendation card, stats strip.|
| Empty    | Hero illustration + CTA "Add your first coffee" → Add Coffee. Hide analytics until ≥ 1 bean exists. |
| Error    | Inline card per failed widget; rest of page still renders.                          |
| Offline  | Banner + recommendations widget shows last cached suggestions with "Cached" tag.    |
| Success  | Greeting, recent ratings (last 7), recommendations (top 3), quick actions, stats.   |

Edge cases: 1 bean / 0 ratings → show "Rate this coffee" CTA on the bean card.

---

## 2. Add Coffee

Multi-step flow. Each step has its own states.

### 2a. Capture
- Loading: camera permission prompt; if denied, switch to file-upload variant with help text.
- Empty: initial state — large camera button + "Upload from photos" + "Skip & enter manually".
- Error: permission denied → instructions per browser; capture failed → "Try again".
- Offline: capture works; banner notes AI extraction will queue.

### 2b. OCR + Parse
- Loading: progress steps "Reading text… → Understanding bag… → Searching the web…" with cancel.
- Empty (no text found): "We couldn't read the bag. Try better lighting, or enter manually." + retry.
- Error: API failure → retry button; offline → automatically queues and advances to confirmation with empty fields.
- Success: jump to Confirm.

### 2c. Web Enrichment
- Loading: "Searching for {roaster} {name}…" with cancel.
- Empty: "No additional info found." Continue.
- Error: silently skip but log; user can re-trigger from Bean Detail.

### 2d. Confirm
- All fields editable. Auto-extracted fields highlighted with a small "AI" chip; user edits clear the chip.
- Required fields: roaster, name. Save disabled until present.
- "Save as draft" always available (skips required-field check; sets `needsReview`).

### 2e. Manual / Barcode / URL / Voice (secondary entry points)
Each declares which fields it can populate; everything else falls through to the same Confirm screen.

---

## 3. Bean Detail

| State    | UI                                                                                          |
|----------|---------------------------------------------------------------------------------------------|
| Loading  | Skeleton for header, photo, attribute grid, ratings section.                                |
| Empty    | N/A — bean exists by definition. If photo missing, attribute card spans full width.         |
| Error    | If load fails, full-page error with retry; if a single rating fails to load, inline error.  |
| Offline  | All cached fields render; "Fetch missing info" disabled with tooltip "Available online".    |
| Success  | Full layout per `ui.md` §3.                                                                 |

Special states:
- `needsReview === true`: yellow banner "Some details are missing — review and save." with shortcut to edit.
- Archived bean: muted card style + "Unarchive" action; "Add rating" hidden.

---

## 4. Ratings List (per bean)

| State    | UI                                                                                          |
|----------|---------------------------------------------------------------------------------------------|
| Loading  | 3 skeleton rows.                                                                            |
| Empty    | "No ratings yet — add your first sip." + CTA "Add rating".                                  |
| Error    | Inline error with retry.                                                                    |
| Offline  | Works fully — ratings are local.                                                            |
| Success  | List newest-first; each row: score, brew type icon, date, notes preview, edit/delete menu.  |

Add rating form validation: score required (1–10 step 0.5), brew type required, ratedAt defaults to now (editable).

---

## 4b. Will I like it? (`/predict`)

- A pre-purchase check on a coffee the user has **not** tried. Nothing on this screen is written to
  the library: a coffee they decided against must not end up in the history skewing later answers.
- Three ways in — a bag photo (OCR + parse), a link to the product page, or typing the details — all
  of which converge on the *same editable form* rather than each producing a verdict directly. OCR is
  often imperfect, so the user corrects it before the verdict is drawn; re-checking costs nothing
  because the estimate is computed locally.
- The verdict is arithmetic on the user's own ratings, not a model call. It works offline, costs
  nothing, cannot invent a preference they never expressed, and shows its working: every claim cites
  a real count and average ("Coffees from Ethiopia average 9.2/10 across 7 cups").
- Shows a predicted score out of 10, a confidence percentage, the evidence for and against, which
  values the history says nothing about, and which attributes were left blank.
- The estimate is shrunk toward the user's own average in proportion to how much evidence there is,
  so a single top-marks cup cannot produce a confident rave.
- Below a confidence floor the verdict is always "could go either way", explicitly described as a
  shrug rather than an answer.
- **Empty state:** under three ratings the screen explains that it needs some history first and
  points at bulk import, rather than showing a confident-looking number derived from noise.
- Editing any field clears the verdict on screen, which would otherwise describe a different coffee
  than the one in the form.

---

## 5. Analytics

| State    | UI                                                                                                  |
|----------|-----------------------------------------------------------------------------------------------------|
| Loading  | Chart placeholders.                                                                                 |
| Empty    | < 5 ratings → "We need a few more ratings to show meaningful trends." Show a sample-data preview.   |
| Error    | Per-chart error card; other charts unaffected.                                                      |
| Offline  | Works fully — derived from local data.                                                              |
| Success  | Charts per `ui.md` §5. Each chart has a "View as table" toggle for accessibility.                   |

---

## 6. Monthly Summary

| State    | UI                                                                                              |
|----------|-------------------------------------------------------------------------------------------------|
| Loading  | Skeleton text blocks + "Generating summary…" if regenerating.                                   |
| Empty    | No ratings in target month → "No coffees logged in {Month}." + button to pick another month.    |
| Error    | LLM summary failed → fallback to **deterministic** summary (top beans, avg score, counts) + retry button for narrative. |
| Offline  | Deterministic summary always renders; narrative shows "Available online".                       |
| Success  | Narrative + stats grid + top beans.                                                             |

Trigger rules:
- Auto-generate on the 1st of each month for the previous month, in the background.
- Cache result in `meta` store; user can regenerate manually (rate-limited to 1/hour).

---

## 7. Settings

| State    | UI                                                                                          |
|----------|---------------------------------------------------------------------------------------------|
| Loading  | Skeleton list.                                                                              |
| Empty    | N/A.                                                                                        |
| Error    | Per-action inline error.                                                                    |
| Offline  | All settings work; "Check for updates" disabled.                                            |
| Success  | Sections: Export, Import, Pending operations, Storage usage, Diagnostics, Reset, About.     |

### Export
- Buttons: "Export CSV", "Export JSON", "Export JSON + photos (zip)".
- Show progress for zips > 1s.
- Verify download started; on failure offer "Copy to clipboard" for JSON.

### Import
- One file picker accepting `.csv` and `.json`; the format is sniffed from the content, not the
  extension, because files shared through chat apps routinely lose their suffix.
- **CSV** is a rating history: one row per cup. `roaster`, `coffee` and `score` are required;
  `brew`, `date`, `notes`, `roast`, `process`, `origin` and `tasting notes` are optional. Column
  names are matched loosely (`Brew Method` = `brew_method` = `brewtype`). "Download CSV template"
  produces a filled example.
- Coffees are derived by grouping rows on roaster + name, compared case- and whitespace-insensitively,
  so a coffee rated five times becomes one bean with five ratings.
- **JSON** restores a backup from the Export buttons above. It merges by id and never overwrites, so
  restoring over a library that has moved on cannot destroy newer entries.
- Nothing is written until the user confirms a plan showing what will be added, what was skipped as
  already recorded, and which rows failed — each with its line number.
- Re-importing the same file is a no-op: ratings de-duplicate on coffee + day + brew + score.
- A blank `brew` column is recorded as a latte; a brew that was *stated* but not recognised is stored
  as `other` and warned about, so a bad value stays visible rather than being quietly assumed away.
- When imported coffees are missing origin, process, roast level or tasting notes, the preview offers
  to look those up on the web (on by default) and reports how many coffees that covers. The lookups
  are queued rather than run inline: a large spreadsheet would otherwise take minutes and fail
  entirely offline, whereas the queue is durable and retries on its own.
- Enrichment only ever fills **empty** fields. Anything in the file is kept exactly as written, so a
  wrong match can add stray metadata but can never overwrite the user's own history.
- A lookup that fails deterministically (no product page, unreadable page) is dropped rather than
  retried forever; the coffee simply keeps what it was imported with.
- On success the preference profile is recomputed, so recommendations reflect the imported history
  immediately.

### Pending operations
- Lists `pendingAiTasks` with type, age, attempts, last error.
- Per-row: Retry now / Cancel.
- Bulk: "Retry all failed", "Clear all".

### Storage usage
- Shows `navigator.storage.estimate()` results.
- Buttons: "Compact photos" (re-encode at lower quality), "Delete archived bean photos".

### Reset
- Two-step confirmation; type the word `RESET`.
- Recommends export first; offers one-click "Export then reset".

---

## State-handling Acceptance Checklist

For every new screen or feature, the PR description MUST tick each item:

- [ ] Loading state with skeleton or spinner appropriate for expected duration
- [ ] Empty state with explanatory copy and a primary action where useful
- [ ] Error state with retry and (where relevant) "details" affordance
- [ ] Offline state with explicit messaging on what is/isn't available
- [ ] Success state matches design intent
- [ ] Keyboard-only walkthrough succeeds
- [ ] Screen reader announces state transitions
- [ ] No layout shift > 0.1 CLS between states
