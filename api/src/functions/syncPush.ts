import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import type { JSONObject, OperationInput } from '@azure/cosmos';
import { errorResponse, json, readJson } from '../lib/http.js';
import {
  CURSOR_ID,
  documentId,
  getSyncContainer,
  readCursor,
  type SyncDocument,
} from '../lib/cosmos.js';
import { UnauthenticatedError, requirePrincipal } from '../lib/principal.js';
import {
  MAX_RECORDS,
  isPushRecord,
  planPush,
  type PushOutcome,
  type PushRecord,
} from '../lib/syncBatch.js';

/**
 * Accepts a chunk of local changes, assigns each one a sequence number, and
 * commits the whole chunk atomically with the cursor that numbers it.
 *
 * The atomicity is the entire point (`specs/sync.md` -> The `seq` cursor).
 * Assigning seq outside the batch would let two devices pushing concurrently
 * produce duplicate or gapped values, and a gap makes `pull` silently skip
 * records — the worst failure available to a sync engine.
 *
 * The decision rules live in `lib/syncBatch.ts` so they can be unit-tested
 * without a Cosmos instance; what remains here is I/O and the retry loop.
 */

/** Contention is normal with two devices; unbounded retry is not. */
const MAX_ATTEMPTS = 3;

interface PushRequest {
  deviceId?: unknown;
  records?: unknown;
}

export interface PushResponse {
  cursor: number;
  results: PushOutcome[];
}

/**
 * Batch bodies are typed as `JSONObject`, whose index signature rejects
 * `unknown`. Our documents carry `payload: unknown` — deliberately, since the
 * server never inspects a record's contents — so this asserts what the wire
 * format already guarantees: the value came from `JSON.parse`.
 */
function asBatchBody(doc: object): JSONObject & { id: string } {
  return doc as unknown as JSONObject & { id: string };
}

/**
 * One attempt at the read-decide-commit cycle.
 *
 * Returns `null` when the cursor moved underneath us: another device committed
 * between our read and our write, so the seq values we chose are no longer free.
 */
async function attemptPush(
  userId: string,
  deviceId: string,
  records: PushRecord[],
): Promise<PushResponse | null> {
  const container = getSyncContainer();
  const { cursor, etag } = await readCursor(userId);

  const existing = await Promise.all(
    records.map(async (record) => {
      const response = await container
        .item(documentId(record.type, record.recordId), userId)
        .read<SyncDocument>();
      return response.resource ?? undefined;
    }),
  );

  const plan = planPush(records, existing, cursor.seq);

  // Everything was stale. No write, and no reason to burn a cursor replace.
  if (plan.writes.length === 0) return { cursor: cursor.seq, results: plan.results };

  const operations: OperationInput[] = plan.writes.map((write) => ({
    operationType: 'Upsert',
    resourceBody: asBatchBody({ ...write, userId, deviceId } satisfies SyncDocument),
  }));

  operations.push(
    etag
      ? {
          operationType: 'Replace',
          id: CURSOR_ID,
          resourceBody: asBatchBody({ ...cursor, seq: plan.nextSeq }),
          ifMatch: etag,
        }
      : {
          // No cursor document yet. Create rather than replace, so two devices
          // racing on a brand-new account resolve by the loser's create failing
          // instead of both claiming seq 1.
          operationType: 'Create',
          resourceBody: asBatchBody({ ...cursor, seq: plan.nextSeq }),
        },
  );

  const response = await container.items.batch(operations, userId);

  // 412 on the guarded cursor replace, or 409 on the create, both mean the same
  // thing: someone else got there first. A batch is all-or-nothing, so nothing
  // was written and the caller can simply try again.
  if (response.code === 412 || response.code === 409) return null;
  if (response.code !== undefined && response.code >= 400) {
    throw new Error(`Sync batch failed with status ${response.code}`);
  }

  return { cursor: plan.nextSeq, results: plan.results };
}

app.http('syncPush', {
  methods: ['POST'],
  // Anonymous at the Functions layer for the same reason as every other route
  // here: SWA linked backends cannot forward a function key. Authorisation is
  // the `authenticated` role on /api/sync/* in staticwebapp.config.json plus
  // requirePrincipal below, which also refuses the untrusted topology.
  authLevel: 'anonymous',
  route: 'sync/push',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    let userId: string;
    try {
      ({ userId } = requirePrincipal(req));
    } catch (err) {
      if (err instanceof UnauthenticatedError) return json(401, { error: err.message });
      return errorResponse(ctx, 500, 'Could not resolve the caller identity', err);
    }

    let body: PushRequest;
    try {
      body = await readJson<PushRequest>(req);
    } catch {
      return json(400, { error: 'Request body must be JSON' });
    }

    const deviceId =
      typeof body.deviceId === 'string' && body.deviceId !== '' ? body.deviceId : 'unknown';
    const raw = Array.isArray(body.records) ? body.records : [];
    if (raw.length > MAX_RECORDS) {
      return json(400, { error: `A push may contain at most ${MAX_RECORDS} records` });
    }

    const records = raw.filter(isPushRecord);
    if (records.length !== raw.length) {
      return json(400, { error: 'One or more records were malformed' });
    }
    if (records.length === 0) {
      const { cursor } = await readCursor(userId);
      return json(200, { cursor: cursor.seq, results: [] } satisfies PushResponse);
    }

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const result = await attemptPush(userId, deviceId, records);
        if (result) {
          ctx.log('sync push', {
            attempt,
            applied: result.results.filter((r) => r.outcome === 'applied').length,
            stale: result.results.filter((r) => r.outcome === 'stale').length,
          });
          return json(200, result);
        }
      }
      // Persistent contention. The client re-queues and backs off rather than
      // us retrying forever and holding a Function invocation open.
      return json(409, { error: 'The sync store is busy. Try again shortly.' });
    } catch (err) {
      return errorResponse(ctx, 502, 'Could not write to the sync store', err);
    }
  },
});
