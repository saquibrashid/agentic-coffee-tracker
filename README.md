# ☕ Agentic Coffee Tracker

> An offline-first, AI-powered coffee tracking PWA. Snap a photo of the bag, let an LLM extract the details, rate every cup, and watch your taste profile emerge.

[![Status: MVP](https://img.shields.io/badge/status-MVP-green)](./specs)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

---

## ✨ What it does

- 📸 **Photo-first capture** — point the camera at a coffee bag; OCR + an LLM extract roaster, origin, process, roast level, tasting notes, and more.
- 🌐 **Aggressive web enrichment** — fills in missing fields by searching and scraping roaster sites.
- ⭐ **Multiple ratings per bean** — track how a coffee evolves across brews and brew types (espresso, latte, pour-over, …).
- 📊 **Insights & monthly summaries** — favorite origins, roasters, flavor patterns, ratings over time.
- 💡 **Recommendations** — suggests new beans grounded in your actual preferences.
- 📦 **Local-first** — all data lives in your browser via IndexedDB. Works offline; nothing leaves your device except images sent for AI processing.
- 📤 **Full export** — CSV + JSON, your data is yours.

## 🏛️ Status

MVP scaffolded and functional with mocked AI services. The BFF (Azure Functions) automatically calls **Azure AI Vision**, **Azure OpenAI**, and **Bing Web Search** when the corresponding environment variables are configured; otherwise it falls back to deterministic mock responses so the app runs end-to-end without Azure credentials.

See `api/local.settings.example.json` for the full list of supported variables.

```
specs/
├── specs.md          # Vision and scope
├── architecture.md   # Topology, BFF, secrets, offline, storage, styling
├── data-model.md     # TypeScript types, enums, LLM JSON schema, IndexedDB layout
├── ui.md             # Screens
├── ux-states.md      # Loading / empty / error / offline / success per screen
├── ai.md             # OCR, LLM, web search, preference modeling
└── copilot.md        # Generation responsibilities for GitHub Copilot
```

## 🧰 Planned tech stack

| Layer         | Choice                                                                       |
| ------------- | ---------------------------------------------------------------------------- |
| Frontend      | **React 18 + TypeScript + Vite** as a **PWA**                                |
| Styling       | **Tailwind CSS** + **shadcn/ui** (Radix primitives) + **lucide-react** icons |
| Charts        | Recharts (lazy-loaded)                                                       |
| Local storage | **IndexedDB** via **Dexie 4**                                                |
| Backend (BFF) | **Azure Functions** (Node 20, TypeScript, v4 model)                          |
| AI services   | Azure AI Vision (OCR), Azure OpenAI (parsing + summaries), Bing Web Search   |
| Hosting       | Azure Static Web Apps (Standard)                                             |
| IaC           | Bicep (`/infra`)                                                             |
| Testing       | Vitest, Testing Library, Playwright, axe-core                                |
| Accessibility | WCAG 2.1 AA target                                                           |

See [`specs/architecture.md`](./specs/architecture.md) for the full rationale.

## 🚀 Getting started

```bash
# Prerequisites: Node 20+, pnpm, Azure Functions Core Tools v4

# 1. Install dependencies
pnpm install
# Packages resolve through the Microsoft feed proxy configured in .npmrc,
# not the public npm registry.

# 2. Configure local env
cp api/local.settings.example.json api/local.settings.json
# fill in Azure Vision / OpenAI / Bing keys — or leave them blank to run
# entirely on deterministic mocks

# 3. Run client + BFF in parallel
pnpm dev          # Vite dev server on http://localhost:5173
pnpm dev:api      # Functions host on  http://localhost:7071

# 4. Tests
pnpm test         # unit + component
pnpm test:e2e     # Playwright
```

No Azure credentials? Everything still works. Each BFF endpoint returns a schema-shaped mock when its keys are missing, and the SPA falls back to the same mocks when the BFF is unreachable (`VITE_ALLOW_MOCK_AI`, on by default in dev). See [`.env.example`](./.env.example).

## ☁️ Deploy to Azure

```bash
azd auth login
azd env new coffee-dev
azd up
```

This provisions a Static Web App, a Flex Consumption Function App, Key Vault, and Application Insights — then deploys both services. A subscription is the only requirement; AI keys are optional.

Budget roughly **$26/month**, almost all of which is the Application Insights availability test (3 locations, every 5 minutes). Everything else lands under a dollar. See [cost expectations](./docs/deployment.md#what-this-costs) to tune it.

Full instructions, monitoring queries, and CI/CD setup are in [`docs/deployment.md`](./docs/deployment.md).

## 🗺️ Roadmap

- **v1** — capture, OCR/LLM parsing, ratings, analytics, monthly summaries, export, recommendations
- **v1.5** — barcode scan, voice input
- **v2** — Microsoft + Apple ID login, Azure cloud sync, café drink tracking, embeddings/vector search, native iOS app

## 🔒 Privacy

- All user data lives locally in IndexedDB.
- Photos are sent to Azure Vision and Azure OpenAI **only for the duration of processing**; the BFF logs no request bodies.
- EXIF is stripped from images before forwarding.
- Settings → Danger zone → **Delete all data** wipes IndexedDB, deletes every Cache Storage entry, and unregisters the service worker. It is gated behind a typed confirmation because the deletion is unrecoverable — export first.

See [`SECURITY.md`](./SECURITY.md) for vulnerability reporting.

## 🤝 Contributing

PRs welcome. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) before opening a pull request.

## 📜 License

[MIT](./LICENSE) © Saquib Rashid
