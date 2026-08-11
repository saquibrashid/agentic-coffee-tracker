/**
 * Transport for the sync endpoints.
 *
 * Separate from `services/ai` because the failure semantics differ: an AI call
 * that fails degrades to a mock, whereas a sync call that fails must be
 * classified — transient failures retry with backoff, terminal ones stop the
 * engine and ask the user to act. `specs/sync.md` -> Backoff.
 */

const APP_VERSION = '0.1.0';

/** Sync is only ever reachable on the SWA origin; see `platform/topology`. */
const SYNC_TIMEOUT_MS = 30_000;

export interface SyncApiErrorInit {
  status: number;
  message: string;
  /** The parsed error body, when there was one. Carries fields like `quota`. */
  details?: Record<string, unknown> | undefined;
}

export class SyncApiError extends Error {
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor({ status, message, details }: SyncApiErrorInit) {
    super(message);
    this.name = 'SyncApiError';
    this.status = status;
    this.details = details;
  }

  /**
   * Whether retrying could plausibly succeed.
   *
   * 401/403 mean the session is gone or the account lacks access, and 400 means
   * this build sent something the server will reject identically forever.
   * Retrying any of them burns the user's session and the endpoint's rate
   * budget without ever converging, so they stop the engine instead.
   */
  get isTransient(): boolean {
    // 409 is contention from another device pushing concurrently, which is the
    // most retryable failure there is: the next attempt sees the new cursor.
    if (this.status === 409 || this.status === 429) return true;
    // 507 sits inside the 5xx range but is not a server fault: the partition is
    // full, and every retry will be refused identically until the user frees
    // space. Retrying would spend the rate budget to learn nothing.
    if (this.status === 507) return false;
    return this.status >= 500;
  }
}

/** A call that never came back. Transient by definition. */
export class SyncTimeoutError extends Error {
  constructor(path: string) {
    super(`POST ${path} timed out after ${SYNC_TIMEOUT_MS}ms`);
    this.name = 'SyncTimeoutError';
  }
}

export interface SyncDocument {
  id: string;
  userId: string;
  type: 'bean' | 'rating' | 'photo';
  recordId: string;
  seq: number;
  updatedAt: string;
  deleted: boolean;
  schemaVersion: number;
  deviceId: string;
  payload: unknown;
}

export interface PullResponse {
  records: SyncDocument[];
  cursor: number;
  hasMore: boolean;
}

export interface PushRecord {
  type: 'bean' | 'rating' | 'photo';
  recordId: string;
  updatedAt: string;
  deleted: boolean;
  schemaVersion: number;
  payload: unknown;
}

export interface PushResponse {
  cursor: number;
  results: { id: string; outcome: 'applied' | 'stale' }[];
}

async function post<TResp>(path: string, body: unknown): Promise<TResp> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      // The SWA session cookie is the whole authentication story here; without
      // this the edge sees an anonymous request and 401s.
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-app-version': APP_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new SyncTimeoutError(path);
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let message = `POST ${path} -> ${response.status}`;
    let details: Record<string, unknown> | undefined;
    try {
      const payload = (await response.json()) as Record<string, unknown>;
      details = payload;
      if (typeof payload.error === 'string') message = payload.error;
    } catch {
      // A non-JSON error body is not worth a second failure mode; the status
      // carries the actionable information.
    }
    throw new SyncApiError({ status: response.status, message, details });
  }

  return (await response.json()) as TResp;
}

export function pull(cursor: number, limit?: number): Promise<PullResponse> {
  return post<PullResponse>('/api/sync/pull', limit === undefined ? { cursor } : { cursor, limit });
}

export function push(deviceId: string, records: PushRecord[]): Promise<PushResponse> {
  return post<PushResponse>('/api/sync/push', { deviceId, records });
}

export interface QuotaInfo {
  used: number;
  limit: number;
}

export interface UploadUrlResponse {
  url: string;
  expiresAt: string;
  quota: QuotaInfo;
}

export interface DownloadUrlResponse {
  url: string;
  expiresAt: string;
}

/**
 * The server has no room for this photo.
 *
 * Not a `SyncApiError`: it is neither transient (retrying changes nothing until
 * space is freed) nor terminal for the engine (records must keep syncing). It
 * is a condition to report, so it gets its own type rather than being forced
 * into a classification that would make the engine do the wrong thing.
 */
export class PhotoQuotaError extends Error {
  constructor(readonly quota: QuotaInfo) {
    super('Photo storage is full.');
    this.name = 'PhotoQuotaError';
  }
}

/** Absent bytes — a metadata row can outlive, or precede, its blob. */
export class PhotoMissingError extends Error {
  constructor(photoId: string) {
    super(`No bytes stored for photo ${photoId}`);
    this.name = 'PhotoMissingError';
  }
}

export async function photoUploadUrl(photoId: string, bytes: number): Promise<UploadUrlResponse> {
  try {
    return await post<UploadUrlResponse>('/api/sync/photo/upload-url', { photoId, bytes });
  } catch (err) {
    if (err instanceof SyncApiError && err.status === 507) {
      throw new PhotoQuotaError(quotaFrom(err));
    }
    throw err;
  }
}

export async function photoDownloadUrl(photoId: string): Promise<DownloadUrlResponse> {
  try {
    return await post<DownloadUrlResponse>('/api/sync/photo/download-url', { photoId });
  } catch (err) {
    if (err instanceof SyncApiError && err.status === 404) throw new PhotoMissingError(photoId);
    throw err;
  }
}

export interface DeleteCloudDataResponse {
  recordsDeleted: number;
  photosDeleted: number;
}

/**
 * `confirm` is the caller's own user id, echoed back.
 *
 * The server checks it against the principal it derived itself, so the
 * irreversible action needs a deliberate signal in the request body rather than
 * just the session cookie every request already carries.
 */
export function deleteCloudData(confirm: string): Promise<DeleteCloudDataResponse> {
  return post<DeleteCloudDataResponse>('/api/sync/delete', { confirm });
}

function quotaFrom(err: SyncApiError): QuotaInfo {
  const quota = err.details?.quota;
  if (
    typeof quota === 'object' &&
    quota !== null &&
    typeof (quota as QuotaInfo).used === 'number' &&
    typeof (quota as QuotaInfo).limit === 'number'
  ) {
    return { used: (quota as QuotaInfo).used, limit: (quota as QuotaInfo).limit };
  }
  // The server always sends this, but a proxy or an older build might not, and
  // losing the whole error to a missing field would be worse than losing the
  // numbers.
  return { used: 0, limit: 0 };
}
