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
}

export class SyncApiError extends Error {
  readonly status: number;

  constructor({ status, message }: SyncApiErrorInit) {
    super(message);
    this.name = 'SyncApiError';
    this.status = status;
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
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload.error === 'string') message = payload.error;
    } catch {
      // A non-JSON error body is not worth a second failure mode; the status
      // carries the actionable information.
    }
    throw new SyncApiError({ status: response.status, message });
  }

  return (await response.json()) as TResp;
}

export function pull(cursor: number, limit?: number): Promise<PullResponse> {
  return post<PullResponse>('/api/sync/pull', limit === undefined ? { cursor } : { cursor, limit });
}

export function push(deviceId: string, records: PushRecord[]): Promise<PushResponse> {
  return post<PushResponse>('/api/sync/push', { deviceId, records });
}
