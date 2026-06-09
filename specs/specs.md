# Agentic Coffee Tracking Web App — Specification

## Vision
Build a **web‑based, offline‑first, AI‑powered coffee tracking application** that allows the user to:

- Capture coffee bean information primarily via **photo of the bag**
- Automatically extract structured data using **OCR + LLM parsing**
- Aggressively search the web for missing details (roaster + coffee name)
- Track ratings (1–10) with **multiple ratings per bean**
- Track brew type (latte, iced latte, drip, etc.)
- Store all data **locally** using IndexedDB
- Export all data as **CSV + JSON**
- Provide **monthly summaries** and on‑demand insights
- Recommend new beans using **web search + preference modeling**
- Work **offline‑first**, with fast capture and high maintainability

## Platform
- **Web app first**
- Must function as a **PWA** (installable, offline, camera access)
- Future extensibility: optional login, cloud sync, native iOS app

## Core Features
- Photo capture → OCR → LLM parsing → structured bean entry
- Web search to fill missing details
- Multiple ratings per bean
- Brew type selection
- Local storage
- Export to CSV + JSON
- Monthly summaries
- Recommendations based on user preferences
- Rich UI with analytics

## Future Features (v2+)
- Café drink tracking
- Microsoft + Apple ID login
- Azure cloud sync
- Embeddings + vector search
- Native iOS app

---

## Companion specs
- `data-model.md` — types, enums, LLM JSON schema, IndexedDB stores, export schemas
- `architecture.md` — BFF, hosting, secrets, offline queue, migrations, security
- `ui.md` — screens and flows
- `ux-states.md` — loading/empty/error/offline/success states per screen
- `ai.md` — OCR, LLM, web search, preference modeling, agent behaviors
- `copilot.md` — generation responsibilities (defers to the above)