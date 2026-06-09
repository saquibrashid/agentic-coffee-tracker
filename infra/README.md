# Infrastructure

Bicep templates land here.

See `specs/architecture.md` for the planned topology:

- Azure Static Web Apps (Standard) hosting the client
- Linked Azure Functions for the BFF endpoints
- Key Vault for `AZURE_VISION_*`, `AZURE_OPENAI_*`, `BING_SEARCH_KEY`
- Application Insights with sampling
