# Security Policy

## Reporting a Vulnerability

**Please do not open public issues for security vulnerabilities.**

If you discover a security issue, report it privately via GitHub's [private vulnerability reporting](../../security/advisories/new) on this repository.

You can expect:

- An acknowledgement within **3 business days**.
- A status update within **10 business days**.
- Credit in the release notes once a fix ships, if you wish.

## Scope

In scope:

- The web client (PWA) source code in this repository
- The Azure Functions BFF (`/api`) source code
- The Bicep infrastructure templates (`/infra`)
- Authentication and sync endpoints, once implemented — see the planned-change section below

Out of scope:

- Third-party services we depend on (Azure AI Vision, Azure OpenAI, Bing Search) — report those to Microsoft directly.
- Vulnerabilities requiring physical access to a user's device.
- Social engineering attacks.

## Hardening already in place

- All Azure keys live server-side only (Functions + Key Vault references).
- Image EXIF is stripped before forwarding to upstream AI services.
- BFF logs no request bodies — only timing, status, and model name.
- CSP locks `connect-src` to the same origin and the BFF host.
- Images fetched during enrichment are identified by magic number, not `Content-Type`, and SVG is refused because it is active content.
- All user data lives client-side in IndexedDB. The BFF is stateless — it has no database, and nothing a user records is persisted server-side.

See `specs/architecture.md` § "Security & Privacy" for full details.

## Planned change: optional cloud sync

`specs/sync.md` specifies opt-in multi-device sync. Sync itself is **specified, not implemented** — no code in this repository sends user data anywhere, and the statement above is accurate for every build shipped to date.

Sign-in is now implemented, and by itself changes nothing about where data lives: signing in establishes a Static Web Apps session and nothing more. Every coffee, rating and photo stays in IndexedDB on the device. It is also **off unless a deployment sets `VITE_AUTH_ENABLED=true`**, which no shipped build does yet.

The statement above will stop being the whole story once sync ships, so the intended end state is recorded here in advance:

- **Signed out stays the default** and keeps today's behaviour exactly: no account, no network storage, no change.
- **Signing in** replicates beans, ratings, and photo metadata to Cosmos DB, and photo bytes to Blob Storage, partitioned per user.
- Data will be encrypted in transit and at rest by the platform, but **not end-to-end**. The operator would be technically capable of reading it. This is a deliberate trade-off, recorded as an open question in `specs/sync.md`.
- Deleting every server-side byte will be possible from inside the app.

Three guarantees are being built in from the start rather than retrofitted:

- Sync **and sign-in** are **hard-disabled** in any build configured to call the Function App directly (`VITE_API_BASE_URL`). In that topology the `x-ms-client-principal` header is attacker-supplied rather than injected by Static Web Apps, so trusting it would expose one user's data to another. The checks live in `src/services/sync/index.ts` and `src/services/auth/index.ts`, both fail closed, and both delegate to one predicate in `src/services/platform/topology.ts` so they cannot drift apart.
- Only identity providers this project has explicitly configured are reachable. `public/staticwebapp.config.json` returns 404 for every other provider, and a principal from an unconfigured one is rejected client-side as well.
- Derived data (preferences, summaries, recommendations) is never uploaded. It is recomputed on each device from the records it already holds.

This section will be replaced with a description of shipped behaviour in the same pull request that enables sync, not in a follow-up.
