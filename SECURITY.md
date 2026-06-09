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

Out of scope:

- Third-party services we depend on (Azure AI Vision, Azure OpenAI, Bing Search) — report those to Microsoft directly.
- Vulnerabilities requiring physical access to a user's device.
- Social engineering attacks.

## Hardening already in place

- All Azure keys live server-side only (Functions + Key Vault references).
- Image EXIF is stripped before forwarding to upstream AI services.
- BFF logs no request bodies — only timing, status, and model name.
- CSP locks `connect-src` to the same origin and the BFF host.
- All user data lives client-side in IndexedDB; nothing is persisted server-side.

See `specs/architecture.md` § "Security & Privacy" for full details.
