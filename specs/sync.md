# Multi-Device Sync Specification

This document specifies cloud sync for the Agentic Coffee Tracker: identity, server-side storage, the replication protocol, conflict policy, photo handling, and the phased delivery plan.

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
- End-to-end encryption. See [Open questions](#open-questions) — this is the main privacy trade-off being accepted.
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

- Identity providers: Microsoft (`/.auth/login/aad`) and Apple (custom OIDC provider).
- The client reads `/.auth/me` to obtain the `clientPrincipal`.
- SWA injects the `x-ms-client-principal` header (base64 JSON) into every linked-backend Function invocation.
- `userId` = `clientPrincipal.userId`, a stable per-provider subject identifier. It is the Cosmos partition key.

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
    { "route": "/.auth/login/twitter", "statusCode": 404 }
  ],
  "auth": {
    "identityProviders": {
      "apple": {
        "registration": {
          "clientIdSettingName": "APPLE_CLIENT_ID",
          "clientSecretSettingName": "APPLE_CLIENT_SECRET"
        }
      }
    }
  }
}
```

Unused providers are explicitly 404'd so SWA's defaults do not silently expose them.

---

## Server-side storage

### Cosmos DB (records)

Serverless, SQL API. One database `coffee`, one container `sync`, partition key `/userId`.

A single container holds every record type. This keeps a user's entire dataset in one logical partition, which is what makes the transactional sequence assignment below possible.

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
  login(provider: 'aad' | 'apple'): Promise<void>;
  logout(): Promise<void>;
}

export type SyncState =
  | 'disabled' // signed out
  | 'idle'
  | 'syncing'
  | 'offline'
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
- **Terminal** (401, 403, 400) — stop, surface in Settings, require re-auth or user action. Never retry a 401 in a loop; it burns the user's session and the endpoint's rate budget.

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

1. Insert the metadata row with no `blob`
2. Fetch bytes on first render, or during idle backfill, whichever comes first

This works because `CoffeeBean.thumbnailDataUrl` is already stored inline on the bean record. A newly-signed-in device renders the full bean library correctly from metadata alone, and full-resolution images fill in behind it. Bandwidth on first sync drops by roughly two orders of magnitude.

**Quota**: 500 MB per user. `/api/sync/photo/upload-url` returns `507` past the cap; the client surfaces it in Settings and continues syncing records, which must not be blocked by a photo problem.

---

## UI

### Settings → Sync (new section)

Signed out:

- Explanation of what leaves the device, linking to the privacy notice
- **Sign in with Microsoft** / **Sign in with Apple**

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

New app settings: `COSMOS_ENDPOINT`, `COSMOS_DATABASE`, `STORAGE_ACCOUNT_NAME`, `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET` (Key Vault reference).

Follow the existing optional-dependency pattern from `architecture.md` → Secrets & Configuration: when `COSMOS_ENDPOINT` is absent, `/api/sync/*` returns `501 Not Implemented` and `/api/health` reports `sync: 'disabled'`. A credential-free deployment must stay a supported configuration.

### CSP

`connect-src` must gain the blob endpoint:

```text
connect-src 'self' https://<bff-host> https://<storage-account>.blob.core.windows.net
```

### Estimated cost

At single-user volumes — a few thousand records, a few hundred MB of photos — Cosmos serverless and Blob hot storage land in the low single-digit dollars per month. Cosmos serverless has no idle floor, so an unused deployment costs only storage.

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

Phase 8 is not optional polish. `SECURITY.md` currently states that all user data lives client-side and nothing is persisted server-side. That sentence becomes false the moment Phase 5 ships, so the documentation change is part of the feature, not a follow-up.

---

## Open questions

Resolve before Phase 2; each has a real bearing on the design.

1. **End-to-end encryption.** Encrypting payloads under a key derived from a user passphrase would preserve the current privacy posture, at the cost of unrecoverable data on a forgotten passphrase and no possibility of future server-side features. Decide now — retrofitting E2EE after data exists requires a migration.
2. **Apple Sign In.** Requires a paid Apple Developer account and a client secret that expires every 6 months, needing rotation. Confirm this is worth it, or ship Microsoft-only in v2.
3. **Photo quota.** Is 500 MB per user right? It is roughly 2,000 photos at the current 1600px/WebP pipeline output.
4. **Tombstone retention.** Tombstones currently live forever in Cosmos. If they are ever garbage-collected, a device whose cursor predates the GC horizon must be forced into a full re-sync. Either accept unbounded tombstones (small, and simplest) or specify the horizon and the forced-resync path.
5. **Multi-provider identity.** Signing in with Microsoft and later with Apple produces two distinct `userId` values and therefore two disjoint datasets. Is an account-linking flow needed, or is a clear warning at sign-in sufficient?
6. **Region and residency.** Single-region deployment implies a data residency choice. Confirm the target region.

---

## Companion specs

- `data-model.md` — record shapes this document replicates
- `architecture.md` — BFF conventions, offline queue, migration policy, security baseline
- `ux-states.md` — state coverage the sync UI must satisfy
