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

### 6. Monthly Summary
- Top beans
- Average rating
- Flavor trends
- New insights

### 7. Settings
- Export (CSV + JSON)
- Data management
- About
