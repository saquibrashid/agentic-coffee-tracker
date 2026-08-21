# GitHub Copilot Instructions

You are GitHub Copilot assisting in building this application.
Use the spec files in this folder as the authoritative specification.

## Spec precedence (resolve conflicts in this order)

1. `data-model.md` — source of truth for types, schemas, enums, LLM contract
2. `architecture.md` — source of truth for boundaries, secrets, offline, storage
3. `ux-states.md` — source of truth for screen states and accessibility
4. `ui.md` — screen layout intent
5. `ai.md` — pipeline behavior
6. `specs.md` — vision and scope
7. `copilot.md` (this file) — generation guidance only; never overrides the above

## Responsibilities

### 1. Project Scaffolding

- Create a React + TypeScript + Vite project
- Configure PWA support
- Implement IndexedDB storage layer (Dexie)
- Implement routing
- Implement camera capture
- Configure **Tailwind CSS** (class-based dark mode, theme tokens via CSS variables)
- Initialize **shadcn/ui** (`components.json`, `src/components/ui/`, `lib/utils.ts`)
- Generate the initial shadcn component set listed in `architecture.md`
- Install **lucide-react** as the sole icon library

### 2. Data Models

Implement TypeScript types for:

- CoffeeBean
- Rating
- UserPreferences

### 3. AI Pipeline

Implement modules for:

- OCR (Azure Vision)
- LLM parsing (Azure OpenAI)
- Web search + scraping
- Preference modeling

Use clean, modular architecture.

### 4. UI Components

Generate React components for:

- Home
- Add Coffee
- Bean Detail
- Ratings List
- Analytics
- Settings

### 5. Storage Layer

- IndexedDB wrapper
- CRUD operations for beans and ratings
- Derived preference calculations

### 6. Export Logic

Implement:

- CSV export (beans.csv, ratings.csv)
- JSON export (full structured export)

### 7. Offline‑First Behavior

- Service worker
- Asset caching
- Data persistence
- Queue AI calls when offline

### 8. Maintainability

- Strong TypeScript typing
- Modular file structure
- Clear separation of concerns
- Unit tests for parsing & storage

### 9. Future‑Proofing

Add placeholder modules for:

- Microsoft login
- Apple ID login
- Azure cloud sync
- Café drink tracking
- Embeddings + vector search
- Native iOS app integration

---

Copilot should generate:

- Components
- Hooks
- Services
- Utilities
- Types
- Tests
- Documentation comments

This file defines how Copilot should behave when generating code for this project.
