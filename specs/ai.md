# AI Pipeline and Agent Behavior

## OCR Pipeline

Use Azure AI Vision to extract raw text from the coffee bag photo.

### Steps

1. User uploads or captures a photo.
2. OCR extracts all visible text.
3. Raw text is passed to LLM parsing.

---

## LLM Parsing

Use Azure OpenAI to convert OCR text into structured fields:

- Roaster
- Coffee name
- Origins
- Process
- Roast level
- Tasting notes
- Roast date
- Any other identifiable metadata

LLM should return a structured JSON object.

---

## Aggressive Web Search & Scraping

If fields are missing:

1. Search the web for **“{roaster} {coffee name}”**
2. Scrape structured data from top results
3. Merge with extracted fields
4. Ask user to confirm before saving

This step should be modular so it can be improved later.

---

## Preference Modeling

Track user ratings over time to infer:

- Favorite origins
- Favorite roasters
- Preferred roast levels
- Preferred processes
- Flavor patterns

Store derived preferences locally.

Future: embeddings + Azure AI Search for similarity.

---

## Agent Behaviors

### Recommendations

- Suggest new beans using web search + preference patterns
- Provide reasoning (“You tend to like Ethiopian naturals”)

### Summaries

- Generate **monthly summaries** automatically
- Provide on‑demand summaries

### Insights

- Rating trends
- Flavor preferences
- Roast level tendencies
- Usage patterns

### Alerts

- “You’re probably low on Bean X based on usage”
