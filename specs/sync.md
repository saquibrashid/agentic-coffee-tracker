# Multi-Device Sync Specification

This document specifies cloud sync for Coffee Bean Tracker: identity, server-side storage, the replication protocol, conflict policy, photo handling, and the phased delivery plan.

It supersedes the `services/sync/` and `services/auth/` placeholders described in `architecture.md` → Future-Proofing Hooks.

**Status**: specified, not implemented. Target: v2.

---

## Goals

- A user signs in on a second device and sees the same beans, ratings, and photos.
- Sync is **opt-in**. Signed-out users keep today's fully local, zero-account experience with no behavioural change.
- Offline-first is preserved. The local IndexedDB copy remains the source of truth for reads; sync is a background reconciliation, never a blocking dependency.
- Conflicts resolve deterministically without prompting the user.
- A user can delete every byte the server holds, from inside the app.

### Non-goals (v2)

- Real-time collaboration or live presence. Sync is periodic pull/push, not a socket.
- Field-level or three-way merge. Conflict resolution is whole-record last-write-wins (see [Conflict policy](#conflict-policy)).
- Sharing data between users.
- End-to-end encryption. See [Decisions](#decisions) § 1 — this is the main privacy trade-off being accepted, and it is settled rather than open.
- Server-side AI or server-side derived data. The BFF stays thin; preferences, summaries, and recommendations remain client-computed.

---

## Why this shape

The app already has the three properties that make replication tractable, and the design leans on all of them:

| Existing property                                            | Why it matters                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| **Client-generated ULIDs** (`data-model.md` → Conventions)   | No server round-trip to mint IDs; two offline devices cannot collide        |
| **`createdAt` / `updatedAt` on every record**                | Last-write-wins needs no new fields on `CoffeeBean` or `Rating`             |
| **`schemaVersion` per record**                               | A stale device can detect and refuse records it does not understand         |
| **Derived data is already recomputable** (`UserPreferences`) | Preferences, summaries, and recommendations are never synced — just rebuilt |

The one thing genuinely missing is **delete tracking**. IndexedDB deletes leave no trace, so a delete on device A is indistinguishable from a record device B has not yet seen. This is solved with an outbox tombstone, below.

---

## Scope of synchronised data

| Store            | Synced  | Rationale                                                        |
| ---------------- | ------- | ---------------------------------------------------------------- |
| `beans`          | **Yes** | Core user data                                                   |
| `ratings`        | **Yes** | Core user data                                                   |
| `photos`         | **Yes** | Metadata in the record stream; bytes in Blob Storage             |
| `preferences`    | No      | Derived; recomputed locally from synced beans + ratings          |
| `ocrResults`     | No      | Debug/diagnostic residue, device-local                           |
| `pendingAiTasks` | No      | A device-local work queue; replicating it would double-run tasks |
| `meta`           | No      | Device-local settings, cursors, theme                            |

Syncing derived data would create a second source of truth that can disagree with its own inputs. Recomputing is cheap and always correct.

---

## Identity

**Provider**: Azure Static Web Apps built-in authentication, as already anticipated in `architecture.md` → Hosting (Auth v2).

- Identity provider: Microsoft (`/.auth/login/aad`). It is the only one — see Decisions § 2 for why Apple was dropped.
- The client reads `/.auth/me` to obtain the `clientPrincipal`.
- SWA injects the `x-ms-client-principal` header (base64 JSON) into every linked-backend Function invocation.
- `userId` = `clientPrincipal.userId`, a stable per-provider subject identifier. It is the Cosmos partition key.
- A successful sign-in records `auth.lastUserId` in Dexie. A later empty `/.auth/me` response means `session-expired` only while that marker exists. Deliberate sign-out clears it and sets `auth.signedOut` before redirecting, so a stale auth response from another tab cannot restore it; starting sign-in clears that intent flag.

### Security constraint (blocking)

`x-ms-client-principal` is trustworthy **only** when the Functions app is reachable exclusively through the SWA linked backend. This repo also supports a Free-tier topology where the client calls the Function App URL directly (`VITE_API_BASE_URL`, `architecture.md` → Secrets & Configuration). In that topology the header is attacker-controlled and would grant access to any user's data.

Therefore:

- Sync endpoints **must** additionally validate the SWA-issued access token, or
- Sync **must** be hard-disabled when `VITE_API_BASE_URL` is non-empty.

Implement the second (a build-time feature flag) for v2, and record the first as the path to supporting the Free tier later. Ship a test that fails if a sync route responds `200` to a request bearing a forged principal header.

### `staticwebapp.config.json` additions

```json
{
  "routes": [
    { "route": "/api/sync/*", "allowedRoles": ["authenticated"] },
    { "route": "/.auth/login/apple", "statusCode": 404 },
    { "route": "/.auth/login/github", "statusCode": 404 },
    { "route": "/.auth/login/twitter", "statusCode": 404 },
    { "route": "/.auth/login/facebook", "statusCode": 404 },
    { "route": "/.auth/login/google", "statusCode": 404 }
  ]
}
```

No `auth.identityProviders` block: Microsoft is the only provider, and it is registered on the Static Web App itself rather than in this file.

Every other provider is explicitly 404'd so SWA's defaults cannot silently expose an identity source nobody reviewed. The client enforces the same allowlist a second time, rejecting a principal that reports an unconfigured provider — reaching that branch means the config failed, and the `userId` in question would otherwise become a partition key.

---

## Server-side storage

### Cosmos DB (records)

Serverless, SQL API. One database `coffee`, one container `sync`, partition key `/userId`.

A single container holds every record type. This keeps a user's entire dataset in one logical partition, which is what makes the transactional sequence assignment below possible.

**Why Cosmos rather than a relational database.** The choice follows from the `seq` cursor, not from preference. Partitioning by `/userId` places a user's whole dataset in one logical partition, and a Cosmos _transactional batch_ is scoped to exactly that — which is what allows sequence numbers to be assigned atomically alongside the records they number. Lose that atomicity and two devices pushing concurrently produce duplicate or gapped `seq` values, at which point pull silently drops records, the worst possible failure for a sync engine.

Alternatives fail on that guarantee or on cost. Table Storage has no multi-document transactions. PostgreSQL Flexible Server and Azure SQL both do, but bill for an always-on instance at roughly $13–15/month, against Cosmos serverless at about $0.25 per million RUs plus $0.25/GB — pennies at personal scale, and nothing at all while idle. Serverless also has no throughput to provision, which suits a workload that is bursty by nature: a few pushes a day, nothing overnight.

**Record document:**

```ts
interface SyncDocument {
  id: string; // `${type}:${recordId}` — unique within the partition
  userId: string; // partition key
  type: 'bean' | 'rating' | 'photo';
  recordId: string; // the ULID of the underlying record
  seq: number; // server-assigned, strictly increasing per user
  updatedAt: string; // ISO 8601, copied from the record — the LWW clock
  deleted: boolean; // tombstone marker
  schemaVersion: number; // copied from the record
  deviceId: string; // origin device, for diagnostics only
  payload: unknown; // the full record, minus blobs; null when deleted
}
```

**Cursor document** — one per user, in the same partition:

```ts
interface CursorDocument {
  id: 'cursor';
  userId: string;
  seq: number; // highest seq assigned so far
  photoBytes: number; // running total, for quota enforcement
}
```

Storage limits to respect: 20 GB per logical partition, 2 MB per document. Neither is reachable with the payload caps in this app, but the photo quota below keeps it that way.

### Blob Storage (photo bytes)

- One container `photos`, private, no public access.
- Blob path: `{userId}/{photoId}`.
- Blobs are **immutable** — a photo ULID never changes content, so there is no conflict resolution for bytes, only presence.
- Access exclusively via short-lived (5 min) user-delegation SAS minted by the BFF. The storage account key is never used and should not exist in app settings.
- Per-user quota: **500 MB**, tracked in `CursorDocument.photoBytes`.

---

## The `seq` cursor

Sync uses a server-assigned, strictly increasing per-user sequence number rather than timestamps.

Timestamps are tempting and wrong here: Cosmos `_ts` has one-second granularity, and client clocks are not trustworthy. A monotonic `seq` gives a strict total order per user, which makes pull resumable, gap-free, and duplicate-free.

Assignment happens inside a **Cosmos transactional batch** scoped to the user's partition:

1. Point-read the cursor document (capture its ETag).
2. For each incoming record, point-read the existing document and apply the [conflict policy](#conflict-policy).
3. Assign each accepted record `seq = ++cursor.seq`.
4. Submit one transactional batch: the accepted upserts plus a cursor replace guarded by `if-match: <etag>`.
5. On `412 Precondition Failed` (a concurrent push from another device), retry the whole chunk. Bound at 3 attempts, then return `409` and let the client re-queue.

Transactional batches cap at **100 operations**, so a push chunk is at most **99 records** plus the cursor write. The client chunks accordingly.

---

## BFF endpoints

All under `/api/sync/*`. All POST except where noted. All require an authenticated principal and the existing `x-app-version` header. All follow the existing convention: JSON in, JSON out, no request bodies logged.

Every one of them opens with `resolveSyncCaller` (`api/src/lib/syncAuth.ts`), which runs authentication, the access policy and the rate limit in that order and returns either the principal or the response to send instead. It exists as one function rather than a copied preamble because the failure mode of the copied version is a new endpoint shipping with one of the three checks missing, and that is not a failure anything else would catch.

The order matters: the rate-limit bucket is keyed by `userId`, so charging it before establishing that the id is real and admitted would let a forged header starve the account it names.

### `POST /api/sync/pull`

```text
Request:  { cursor: number, limit?: number }   // limit default 200, max 500
Response: { records: SyncDocument[], cursor: number, hasMore: boolean }
Errors:   401 unauthenticated, 429 rate-limited
```

```sql
SELECT * FROM c
WHERE c.userId = @userId AND c.seq > @cursor AND c.id != 'cursor'
ORDER BY c.seq
OFFSET 0 LIMIT @limit
```

`cursor` in the response is the highest `seq` returned, or the request cursor when empty. `hasMore` is `true` when the page was full; the client loops until it is `false`.

### `POST /api/sync/push`

```text
Request:  { deviceId: string, records: PushRecord[] }   // max 99 records
Response: { cursor: number, results: { id: string, outcome: 'applied' | 'stale' }[] }
Errors:   400 oversized batch, 401 unauthenticated, 409 contention after retries, 507 quota exceeded
```

```ts
interface PushRecord {
  type: 'bean' | 'rating' | 'photo';
  recordId: string;
  updatedAt: string;
  deleted: boolean;
  schemaVersion: number;
  payload: unknown | null;
}
```

`outcome: 'stale'` means the server held a newer `updatedAt` and rejected the write. The client drops the outbox entry and waits for the winning version to arrive on the next pull.

A chunk that would take the partition past `SYNC_RECORD_QUOTA` (default 20,000 live records) is refused **whole**, with 507 and `{ quota: { used, limit } }`. Refusing whole rather than truncating is forced by the response shape: a partial apply would leave the remainder reported as neither `applied` nor `stale`, and the client has no third state to file them under. Deletes are accepted even at the ceiling, or a full partition would have no way to become less full.

The count lives on the cursor document and is updated inside the same transactional batch that writes the records, so it costs no extra RU and cannot drift from what it counts. A partition whose cursor predates the quota is counted once, lazily, on its next push.

### `POST /api/sync/photo/upload-url`

```text
Request:  { photoId: string, byteSize: number, contentType: string }
Response: { uploadUrl: string, expiresAt: string }
Errors:   400 unsupported content type, 409 blob already exists, 507 quota exceeded
```

Content type must be one of the bitmap types already allowed by `/api/image` (PNG, JPEG, WebP, GIF, AVIF). SVG stays rejected for the same reason it is rejected there — it is active content.

### `POST /api/sync/photo/download-url`

```text
Request:  { photoId: string }
Response: { downloadUrl: string, expiresAt: string }
Errors:   404 unknown photo
```

### `GET /api/sync/status`

```text
Response: { userId, cursor, recordCount, photoBytes, photoQuotaBytes }
```

### `DELETE /api/sync/account`

```text
Response: { deletedRecords: number, deletedBlobs: number }
```

Deletes every Cosmos document and every blob under the user's prefix. Required by the privacy commitments in `SECURITY.md`, and the reason the client-side **Delete all data** control in Settings must grow a "…and from the cloud" branch.

---

## Client architecture

### New modules

```text
src/services/
  auth/
    types.ts          # AuthProvider interface
    localOnly.ts      # LocalOnlyAuthProvider — signed out, today's behaviour
    swa.ts            # SwaAuthProvider — /.auth/me, login, logout
  sync/
    types.ts          # SyncEngine interface, SyncStatus
    noop.ts           # NoopSyncEngine — used when signed out
    cloud.ts          # CloudSyncEngine — the implementation below
    merge.ts          # pure LWW resolution, unit-tested in isolation
    outbox.ts         # enqueue / coalesce / drain
    photos.ts         # lazy blob upload + backfill download
```

### Interfaces

```ts
export interface AuthProvider {
  getUser(): Promise<AuthUser | null>;
  login(provider: 'aad'): Promise<void>;
  logout(): Promise<void>;
}

export type SyncState =
  | 'disabled' // sync unsupported in this build
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'session-expired' // local changes remain queued until reauthentication
  | 'error'
  | 'needs-upgrade'; // remote schemaVersion exceeds this build

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt: string | null;
  pendingCount: number;
  lastError?: string;
}

export interface SyncEngine {
  status(): SyncStatus;
  subscribe(fn: (s: SyncStatus) => void): () => void;
  sync(): Promise<void>; // pull, merge, push — the full cycle
  reset(): Promise<void>; // clear cursor + outbox, forcing a full re-pull
}
```

`NoopSyncEngine` reports `state: 'disabled'` and resolves immediately, so every call site can be written once and remain correct while signed out.

### Dexie v3 migration

One new store. Bump `CoffeeDB` to version 3 in `src/services/db/index.ts`; the existing stores are unchanged, so no `upgrade()` body is needed beyond creating it.

```ts
outbox: 'id, [type+recordId], queuedAt';
```

```ts
export interface OutboxEntry {
  id: string; // ULID
  type: 'bean' | 'rating' | 'photo';
  recordId: string;
  op: 'upsert' | 'delete';
  deletedAt?: string; // set when op === 'delete'; the LWW clock for tombstones
  queuedAt: string;
  attempts: number;
  lastError?: string;
}
```

Two deliberate choices:

- **Upsert entries carry no payload.** The record is read fresh from its table at push time, so an entry can never push a stale snapshot, and repeated edits to one record collapse into a single push.
- **The outbox doubles as the tombstone store.** A delete removes the row and writes an outbox entry carrying `deletedAt`. This avoids adding a `deletedAt` column to `CoffeeBean` and `Rating`, which would otherwise force every existing query in the app to filter soft-deleted rows.

The compound index `[type+recordId]` exists so enqueue can coalesce: if an entry for that pair is already pending, update it in place rather than appending.

### New `meta` keys

| Key                 | Value                                    |
| ------------------- | ---------------------------------------- |
| `sync.deviceId`     | ULID, generated once per browser profile |
| `sync.cursor`       | number, last successfully applied `seq`  |
| `sync.lastSyncedAt` | ISO 8601                                 |
| `sync.enabled`      | boolean, user toggle in Settings         |
| `auth.lastUserId`   | last authenticated stable user id        |
| `auth.signedOut`    | deliberate sign-out intent across tabs   |

---

## The sync cycle

Order matters. The cycle is **pull → merge → push**, never the reverse: pushing first would let a device overwrite remote changes it has not yet seen, defeating the merge.

```text
1. Acquire the 'coffee-sync' Web Lock (navigator.locks).
   Reuses the single-runner pattern QueueRunner already uses, so N open
   tabs perform one sync, not N.

2. PULL loop
   while hasMore:
     POST /api/sync/pull { cursor }
     for each record:
       apply per Conflict policy
     cursor = response.cursor        # advances even when nothing applied
     persist cursor to meta

3. PUSH loop
   while outbox is non-empty:
     take up to 99 entries
     hydrate upserts from their tables; deletes use entry.deletedAt
     POST /api/sync/push { deviceId, records }
     delete applied AND stale entries from the outbox
     on failure: increment attempts, apply backoff, stop this cycle

4. Recompute UserPreferences if any bean or rating changed.
   Preferences are derived and were invalidated by the merge.

5. Kick photo reconciliation (asynchronous, see Photos).

6. Release the lock; publish SyncStatus.
```

A device re-pulls its own pushed records on the following cycle, because the server assigned them fresh `seq` values. This is harmless: `updatedAt` will be equal, so the merge skips the write. Not filtering these out is a deliberate simplification — correctness does not depend on the server tracking which device has seen what.

### Triggers

| Trigger                      | Behaviour                     |
| ---------------------------- | ----------------------------- |
| App start, if signed in      | Immediate                     |
| `online` event               | Immediate                     |
| `visibilitychange` → visible | Immediate if > 60s since last |
| Local mutation               | Debounced 5s                  |
| Periodic while tab visible   | Every 5 minutes               |
| Settings → Sync now          | Immediate                     |

No background sync when the tab is closed. `architecture.md` → Browser Support already documents this constraint for the AI queue; sync inherits it.

### Backoff

Reuse the queue's schedule: `min(60s * 2^attempts, 1h)`, max 8 attempts. Distinguish two failure classes:

- **Transient** (network, 429, 5xx, 409 contention) — retry.
- **Expired session** (401) — publish `session-expired`, keep local changes queued, and prompt reauthentication.
- **Terminal** (403, 400) — stop, surface in Settings, and require user action.

---

## Conflict policy

**Whole-record last-write-wins on `updatedAt`.**

Both the server (in push) and the client (in merge) apply the identical rule, implemented once in `sync/merge.ts` and shared:

```text
accept incoming  iff  incoming.updatedAt > existing.updatedAt   (strict)
```

Rules and their reasons:

- **ISO 8601 UTC strings compare correctly as strings.** `data-model.md` mandates `new Date().toISOString()`, which is fixed-width and UTC, so lexicographic order equals chronological order. No parsing required.
- **Exact ties keep the existing record.** First-writer-wins on a tie makes the operation idempotent: re-pushing an unchanged record is a guaranteed no-op, which is what makes retry-on-timeout safe.
- **Deletes are ordinary writes.** A tombstone with a newer `deletedAt` beats an edit; an edit with a newer `updatedAt` resurrects a deleted record. Both are defensible, and having one rule instead of two removes a class of bug.
- **A delete of a bean does not cascade to its ratings on the server.** The client already handles cascade locally; the resulting rating deletes enter the outbox as their own entries.
- **Schema guard.** If `incoming.schemaVersion` exceeds the version this build understands, do not apply it. Set `SyncStatus.state = 'needs-upgrade'` and halt the cycle. This mirrors the existing `meta.dbSchemaVersion` boot gate in `architecture.md` → IndexedDB & Migrations: a stale client must degrade loudly, never silently downgrade a record.

Field-level merge is explicitly out of scope. The realistic conflict — the same user editing one bean on two devices within one sync interval — is rare, and losing one field edit is a far smaller harm than the complexity and failure modes of a merge engine. Revisit only if telemetry shows real conflict volume.

Log every rejected write (`recordId`, both timestamps, both device IDs) to the existing in-app diagnostics ring buffer. Conflicts must be observable when a user reports "my edit disappeared".

---

## Photos

Photo bytes are the dominant payload and are handled out-of-band from the record stream.

**Metadata** travels as a `photo` record: everything in `PhotoBlob` except `blob`.

**Upload** (blob before metadata — never the reverse, or other devices see a dangling pointer):

1. `POST /api/sync/photo/upload-url`
2. `PUT` the blob directly to the SAS URL
3. Enqueue the `photo` metadata record in the outbox

**Download** is lazy. On pulling a `photo` record whose blob is absent locally:

1. Insert the metadata row with a zero-length placeholder blob
2. `POST /api/sync/photo/download-url`, then `GET` the SAS URL, during idle backfill

A zero-length blob is the marker for "row present, bytes still to come" — there is no separate flag, so the two cannot disagree. Backfill is capped per cycle: a device signing in against a large library must not open one request per photo for images nobody is waiting on. `404` from the download endpoint is a legitimate state, not an error — the uploading device may simply still be offline.

This works because `CoffeeBean.thumbnailDataUrl` is already stored inline on the bean record. A newly-signed-in device renders the full bean library correctly from metadata alone, and full-resolution images fill in behind it. Bandwidth on first sync drops by roughly two orders of magnitude.

**Quota**: 500 MB per user. `/api/sync/photo/upload-url` returns `507` past the cap; the client surfaces it in Settings and continues syncing records, which must not be blocked by a photo problem. Usage is measured by listing the user's blob prefix rather than by maintaining a counter: a counter has to be incremented when the credential is issued, before the upload has happened, so every abandoned upload inflates it permanently and silently.

**Credentials**: every URL is a user-delegation SAS, signed with a key obtained through the managed identity — there is no account key to leak. Uploads get `create`+`write` only and downloads `read` only, both HTTPS-only and valid for 15 minutes. The blob path is derived from the caller's own principal, so a signed URL can only ever address the caller's own photo.

---

## UI

### Settings → Sync (new section)

Signed out:

- Explanation of what leaves the device, linking to the privacy notice
- **Sign in with Microsoft**

Signed in:

- Account identity and **Sign out** (local data is retained on sign-out; state returns to `disabled`)
- Status line: `Synced 2 minutes ago` / `3 changes pending` / `Offline — will sync when reconnected` / `Sign-in expired`
- **Sync now**
- Storage: records synced, photo bytes used against quota
- **Delete cloud data** — typed confirmation, matching the existing destructive-action pattern in `ux-states.md`

### Global indicator

Extend the existing offline indicator rather than adding a second status surface. Sync state is shown only when it is `syncing`, `error`, or `needs-upgrade` — an idle, working sync should be invisible.

### `ux-states.md` additions

Add the `needs-upgrade` state (app build older than the remote schema): full-screen block, "Please refresh to continue syncing", with local data still readable.

---

## Infrastructure

Additions to `/infra`:

| Resource                     | Configuration                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Cosmos DB account            | Serverless, SQL API, single region, session consistency                                     |
| Cosmos database `coffee`     | Container `sync`, partition key `/userId`, default indexing                                 |
| Storage account              | StorageV2, HTTPS-only, public access disabled, blob container `photos`                      |
| Managed identity assignments | Function App → **Cosmos DB Built-in Data Contributor**; → **Storage Blob Data Contributor** |

Use managed identity throughout. Cosmos and Storage keys must not appear in app settings or Key Vault — user-delegation SAS requires the identity path anyway, and it removes an entire class of secret to rotate.

New app settings: `COSMOS_ENDPOINT`, `COSMOS_DATABASE`, `STORAGE_ACCOUNT_NAME`. No identity-provider secrets: Microsoft is registered on the Static Web App itself, and dropping Apple removed the one client secret that would have needed rotating every 6 months.

Follow the existing optional-dependency pattern from `architecture.md` → Secrets & Configuration: when `COSMOS_ENDPOINT` is absent, `/api/sync/*` returns `501 Not Implemented` and `/api/health` reports `sync: 'disabled'`. A credential-free deployment must stay a supported configuration.

### CSP

`connect-src` gains the blob endpoint:

```text
connect-src 'self' https://<storage-account>.blob.core.windows.net
```

Shipped. The account name carries a per-environment token, so the policy is generated at build time from the `AZURE_PHOTO_STORAGE_ACCOUNT_NAME` infrastructure output rather than written out as a literal — see `build-config/csp.ts`. A deployment without a linked backend omits the entry entirely, because photos never leave the device there.

### Estimated cost

At single-user volumes — a few thousand records, a few hundred MB of photos — this is **a few cents a month**, verified against the East US 2 retail prices (Cosmos serverless $0.25/1M RUs and $0.25/GB-month; blob hot LRS $0.02/GB-month).

The dominant term is the 5-minute poll under [Triggers](#triggers), not the writes. A tab left open 24 hours a day is ~288 polls/day at roughly 6 RU for an empty pull, which is about 52,000 RUs a month — under two cents. Records occupy a couple of megabytes and photos are bounded by the 500 MB per-user quota, so storage is another cent.

Neither service has an idle floor, so an unused deployment bills essentially nothing. The failure modes are bounded too: backoff caps at 8 attempts and one hour, and even a pathological once-per-second retry sustained for a full month would reach only about $4.

---

## Testing

| Level       | Coverage                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `merge.ts` — every LWW branch: newer wins, older loses, tie keeps existing, delete-vs-edit both orders, schema guard                                     |
| Unit        | `outbox.ts` — coalescing, delete-after-upsert, drain ordering, backoff                                                                                   |
| Unit        | Push handler — LWW rejection, `seq` monotonicity, batch chunking at the 99 boundary, 412 retry                                                           |
| Integration | Pull pagination — cursor advances correctly across pages and resumes after an interrupted loop                                                           |
| E2E         | Two Playwright browser contexts as two devices: create on A → appears on B; conflicting edits converge to one value on both; delete on A propagates to B |
| E2E         | Offline: mutate offline, reconnect, verify convergence                                                                                                   |
| Security    | Forged `x-ms-client-principal` is rejected; user A cannot read user B's records or blobs                                                                 |

The two-context E2E test is the one that actually proves the feature. Prioritise it over breadth of unit coverage.

It lives in `e2e/two-device.sync.spec.ts` and runs under its own Playwright config (`playwright.sync.config.ts`) on its own dev server, because sync is gated behind `VITE_AUTH_ENABLED` and turning that on for the shared server would change the conditions every other e2e test runs under.

Two browser contexts are two devices in the way that matters: separate IndexedDB, separate Web Locks namespace, separate engine instance, one shared backend. The backend is a fake — an in-process `FakeSyncService` the contexts both route to — because the claim under test is that the _client_ converges, not that Cosmos works. Its two load-bearing rules, monotonic server-assigned `seq` and strictly-greater LWW, mirror `api/src/lib/syncBatch.ts`, which is separately unit-tested.

Two things about that harness are worth knowing before extending it:

- `context.setOffline(true)` does **not** make an intercepted route fail. Playwright fulfils a `context.route` handler without touching the network, so a device the test believes is offline will still push successfully. Simulating offline needs the route itself to `abort('internetdisconnected')`; `setOffline` is still used alongside it, because that is what moves `navigator.onLine`, which the engine reads to tell "offline" from "error".
- **A page load is a sync trigger.** `start()` runs a cycle immediately, so anything queued before a `goto` is already gone by the time the page renders.

---

## Delivery phases

Each phase is independently mergeable and leaves `main` shippable.

| Phase | Scope                                                                                                         | Exit criteria                                               |
| ----- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 0     | `AuthProvider` + `SyncEngine` interfaces, `LocalOnlyAuthProvider`, `NoopSyncEngine`, wired into the app shell | No behaviour change; interfaces exist and are called        |
| 1     | SWA auth: providers configured, sign-in/out UI, `/.auth/me` plumbing                                          | User can sign in and out; nothing syncs yet                 |
| 2     | Bicep: Cosmos, Storage, managed identity, RBAC; `/api/health` reports `sync`                                  | `azd up` provisions cleanly; health reflects configuration  |
| 3     | Dexie v3 `outbox` store; every mutation site enqueues; `merge.ts` written and unit-tested                     | Outbox fills correctly; still nothing leaves the device     |
| 4     | `/api/sync/push` + `/api/sync/pull` with `seq` assignment and LWW                                             | Endpoints pass integration tests against the emulator       |
| 5     | `CloudSyncEngine`: full cycle, Web Lock, triggers, backoff, status                                            | **Two-device E2E test passes** — the milestone that matters |
| 6     | Photo upload/download SAS, lazy backfill, quota                                                               | Photos converge across devices; quota enforced              |
| 7     | Settings → Sync UI, global indicator, `needs-upgrade` state, cloud data deletion                              | Full UX per `ux-states.md`                                  |
| 8     | Hardening: security tests, rate limits, `SECURITY.md` and privacy notice rewrite, docs                        | Privacy documentation matches reality                       |

Phase 8 shipped in two parts. The limits — a per-user request budget, a 20,000-record ceiling, the shared `resolveSyncCaller` gate, and the `SECURITY.md` rewrite including a plain-language "What is stored, and where" table — came first. The two-device E2E followed, along with the isolation tests that pin cross-user separation.

Phase 8 is not optional polish. `SECURITY.md` currently states that all user data lives client-side and nothing is persisted server-side. That sentence becomes false the moment Phase 5 ships, so the documentation change is part of the feature, not a follow-up.

---

## Decisions

Resolved before Phase 2. Recorded here with the reasoning, because each one is
load-bearing and the reasoning is what a future reader will need in order to
revisit it safely.

### 1. No end-to-end encryption

**Decided: payloads are stored as plaintext, protected by TLS in transit and platform-managed encryption at rest.**

The deciding fact is that in this deployment the data subject and the operator
are the same person — it runs in the owner's own Azure subscription. E2EE defends
notes against whoever runs the server, and here that is the user themselves, so
the threat it addresses does not exist while its costs are permanent:

- A forgotten passphrase means **unrecoverable data**. There is no reset path by construction.
- Every additional device needs a key transfer, not just a sign-in.
- Server-side features become impossible forever — no search across a library, no sharing, no server-side enrichment.
- Schema migrations could only run on-device, so a device that never comes back would hold the only copy of an old-format record.

It would also leak more than it appears to. `seq`, `updatedAt`, `type` and blob
size must remain plaintext or the conflict policy above cannot run, so an
observer still learns how many records exist, when they change, and how large
the photos are.

What is guaranteed instead: HTTPS everywhere, encryption at rest, per-user
partitioning, and the ability to delete every server-side byte from inside the
app (Phase 7). `SECURITY.md` states plainly that the deployment operator is
technically capable of reading stored data.

**Revisit if** the app is ever operated for users other than the operator. That
changes the threat model, and this decision with it — but it requires a
migration, because the data already exists in plaintext by then.

### 2. Microsoft-only sign-in — Apple dropped

**Decided: Microsoft Entra is the only identity provider. Apple Sign In is removed from this spec, not deferred.**

It required a paid Apple Developer account and a client secret expiring every 6
months, so the cost was a recurring manual rotation that outlives the feature
work and fails closed — silently, on a schedule, long after anyone remembers
why. For one identity provider serving one user that is a bad trade.

`AuthProviderId` is therefore a single-member union rather than a list, and
`public/staticwebapp.config.json` continues to return 404 for Apple along with
every other provider this project has not configured.

**Consequence:** open question 5 (multi-provider identity) disappears. One
provider means one `userId` per user and no possibility of the two-disjoint-datasets
problem, so no account-linking flow is needed.

### 3. Photo quota: 500 MB per user

**Decided as specified.** Roughly 2,000 photos through the current 1600px/WebP
pipeline, and comfortably inside the 20 GB logical-partition ceiling. Tracked in
`CursorDocument.photoBytes`.

### 4. Tombstones are kept indefinitely

**Decided: no garbage collection.** A tombstone is a few hundred bytes, and
collecting them would require every device whose cursor predates the horizon to
be forced into a full re-sync — real complexity, a rare and expensive failure
mode, in exchange for negligible storage. Revisit only if tombstones become a
measurable share of a partition.

### 5. Multi-provider identity

**Not applicable.** Resolved by decision 2.

### 6. Region and residency

Single-region, matching the region the existing resources are deployed to, so
sync introduces no new residency question beyond the one already answered by the
current deployment.

### 7. Access policy — who may sync

Authentication is not a restriction. Microsoft accounts are free and unlimited,
so "signed in" admits anyone on the internet, and each new account mints a
partition in the owner's Cosmos container and spends the owner's RUs.

Access is therefore a separate, explicit decision, expressed as configuration
rather than code so the deployment can widen without a code change:

| `SYNC_ACCESS_MODE` | Who may sync                                     |
| ------------------ | ------------------------------------------------ |
| `owner` (default)  | Only accounts named in `SYNC_ALLOWLIST`          |
| `allowlist`        | Identical enforcement; states a different intent |
| `open`             | Any signed-in account from an approved provider  |

`owner` and `allowlist` behave identically on purpose. Keeping them distinct
means widening from one person to a group is a one-word change whose meaning is
legible in the deployment configuration, rather than a list that quietly grows.

Two rules make the failure modes safe:

- **An empty allowlist denies everyone, including the owner.** Treating
  "unconfigured" as "unrestricted" would open the deployment the moment a
  parameter went missing.
- **An unrecognised mode falls back to membership, never to `open`.** A typo
  must not be the thing that publishes a library to the world.

Enforced server-side in `api/src/lib/access.ts`, on both push and pull. Pull
alone would be insufficient: a rejected account could still write records that a
later policy change would start serving.

The rejection message names the caller's own id so the fix is a copy-and-paste,
and never names an approved account.

---

## Companion specs

- `data-model.md` — record shapes this document replicates
- `architecture.md` — BFF conventions, offline queue, migration policy, security baseline
- `ux-states.md` — state coverage the sync UI must satisfy
