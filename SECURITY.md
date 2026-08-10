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
- User data lives client-side in IndexedDB, and stays there entirely while signed out. Signing in replicates it to a per-user partition in Cosmos DB; see "Cloud sync" below.

See `specs/architecture.md` § "Security & Privacy" for full details.

## Cloud sync

Multi-device sync is implemented (`specs/sync.md`). It changes where user data
can live, so the behaviour is described here rather than summarised.

- **Signed out is the default and stores nothing remotely.** No account, no
  network storage, no change from earlier builds. Sync only ever runs for a
  signed-in user.
- **Signing in** replicates beans, ratings, and photos to the operator's
  subscription, in a partition keyed by the user's stable provider identifier —
  and only for accounts this deployment has approved. Records go to Cosmos DB;
  photo _bytes_ go to Blob Storage, out-of-band from the record stream.
- **Derived data is never uploaded.** Preferences, summaries and
  recommendations are recomputed on each device from the records it already
  holds.
- **Data is encrypted in transit and at rest by the platform, but not
  end-to-end.** The operator is technically capable of reading it. This is a
  settled decision, recorded with its reasoning in `specs/sync.md` → Decisions
  § 1: the app runs in its owner's own subscription, so the data subject and
  the operator are the same person, and end-to-end encryption would trade a
  threat that does not exist here for data that is permanently unrecoverable if
  a passphrase is forgotten. It would also leak the timing, count and size of
  records regardless, because the conflict-resolution metadata has to stay
  readable.

### Controls enforced in code

- **Only approved accounts may sync.** Signing in proves who someone is; it does
  not entitle them to storage in this deployment. `SYNC_ACCESS_MODE` and
  `SYNC_ALLOWLIST` decide who is admitted, enforced in `api/src/lib/access.ts`
  on both push and pull. The default is closed: an empty allowlist rejects every
  account, including the owner's, so a missing parameter cannot silently open
  the deployment. See `specs/sync.md` → Decisions § 7 and `docs/deployment.md`.
- **Sync and sign-in are hard-disabled in any build configured to call the
  Function App directly** (`VITE_API_BASE_URL`). In that topology the
  `x-ms-client-principal` header is attacker-supplied rather than injected by
  Static Web Apps, so trusting it would expose one user's data to another. The
  checks live in `src/services/sync/index.ts` and `src/services/auth/index.ts`,
  both fail closed, and both delegate to one predicate in
  `src/services/platform/topology.ts` so they cannot drift apart.
- **The server derives the user from the injected principal, never from the
  request body.** `api/src/lib/principal.ts` rejects a request whose principal
  is absent or malformed, so a client cannot name the partition it reads or
  writes.
- **Only identity providers this project has explicitly configured are
  reachable.** `public/staticwebapp.config.json` returns 404 for every other
  provider, and a principal from an unconfigured one is rejected client-side as
  well.

- **Photo bytes never travel through the API, and never through a shared
  credential.** The browser uploads and downloads directly against Blob Storage
  using a user-delegation SAS — signed via the managed identity, so there is no
  account key to leak — scoped to a single blob, restricted to HTTPS, valid for
  15 minutes, and write-only for uploads. The blob path is derived from the
  caller's own principal in `api/src/lib/blob.ts`, so a signed URL cannot be
  made to address another user's photo.
- **Photo storage is capped at 500 MB per user.** Past the cap the upload
  endpoint returns 507 and record sync continues unaffected.

- **A user can delete everything the server holds, from inside the app.**
  Settings → Sync → **Delete cloud data** removes every record and every photo
  blob in that user's partition. The endpoint requires the caller to echo their
  own user id in the request body, which the server checks against the principal
  it derived itself, so a cross-site request riding the session cookie cannot
  trigger it. The local copy is deliberately untouched: this is a decision about
  where data lives, not a decision to lose it.

### Not yet implemented

Recorded here so the gaps are not mistaken for guarantees:

- **A bound on record storage.** Photo bytes are capped, but nothing limits how
  many records a signed-in account can write.
