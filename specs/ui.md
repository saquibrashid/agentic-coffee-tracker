# UI Specification

## Home Screen

Copilot may choose the layout, but it must be **rich and information‑dense**.

Possible elements:

- Dashboard (charts, trends, recommendations)
- Timeline of recent coffees
- Card list of beans with photos

---

## Screens

### 1. Home

- Overview of recent activity
- Recommendations
- Quick actions (Add Coffee, Export, Analytics)

### 2. Add Coffee

Primary flow:

1. Capture or upload photo
2. OCR + LLM parsing
3. Web search for missing fields
4. User confirmation
5. Save bean entry

Photo capture has two entry points, both feeding the same pipeline from step 2
onward:

- **In-app camera** — a live preview with a shutter button, via
  `getUserMedia({ video: { facingMode: 'environment' } })`. Offered only where
  `navigator.mediaDevices.getUserMedia` exists, so an insecure origin or a
  device with no camera simply does not see the button. Permission denial, no
  camera, and a camera held by another app are each explained specifically
  rather than shown as one generic failure. The stream is released on capture,
  on cancel, and on unmount.
- **File input** — for choosing an existing image. Deliberately carries no
  `capture` attribute: on iOS Safari that attribute removes the "Photo Library"
  option entirely, so an existing photo of a bag could not be used.

Secondary flows:

- Manual entry
- Barcode scan
- Paste URL → scrape
- Voice input

### 3. Bean Detail

Must include:

- Bag photo
- Roaster
- Coffee name
- Origins
- Process
- Roast level
- Tasting notes
- Roast date
- Ratings timeline
- Brew types used
- “Fetch missing info” button

### 4. Ratings List

- All ratings for this bean
- Add new rating
- Brew type selector

### 5. Analytics

- Ratings over time
- Favorite origins
- Favorite roasters
- Roast level distribution
- Brew type usage

### 6. Settings

- Export (CSV + JSON)
- Data management
- About

## Waiting

Anything that runs long enough to look stuck must say so, because a spinner
after ninety seconds is the same picture as a spinner after one — and the
reasonable response to a picture that has not changed is to press the button
again, which turns one slow call into two.

- Say the cost **before** the user commits, not only after. A wait someone was
  warned about is a plan; the same wait unannounced is a fault they are
  deciding whether to interrupt.
- Use `LongWait` for anything model-backed. It carries a seconds counter, which
  is the only part of the display that proves time is passing rather than
  asserting it.
- Never fabricate a percentage. These operations are model calls behind a
  queue and have none to report; a bar that crawls to 90% and parks there
  teaches the user to disbelieve every other progress bar in the app.
- Work that is queued and durable should be **reported, not offered**. A button
  to start what is already running produces duplicate work and a slower answer;
  a notice that removes itself when the queue finishes cannot outlive the thing
  it describes.
