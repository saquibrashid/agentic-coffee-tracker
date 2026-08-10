import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import { CURSOR_ID, getSyncContainer, type SyncDocument } from '../lib/cosmos.js';
import { UnauthenticatedError, requirePrincipal } from '../lib/principal.js';

/**
 * Returns every record written after the client's cursor.
 *
 * `specs/sync.md` -> BFF endpoints. Ordering by the server-assigned `seq`
 * rather than a timestamp is what makes this resumable, gap-free and
 * duplicate-free: Cosmos `_ts` has one-second granularity and client clocks are
 * not trustworthy, so either would silently drop records under load.
 */

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

interface PullRequest {
  cursor?: unknown;
  limit?: unknown;
}

export interface PullResponse {
  records: SyncDocument[];
  cursor: number;
  hasMore: boolean;
}

function parseCursor(value: unknown): number {
  // A missing cursor means "everything", which is the correct first-sync
  // behaviour. A malformed one is clamped rather than rejected: the failure
  // mode of re-sending records the client already has is a wasted merge, while
  // rejecting would wedge a client that can never make progress.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function parseLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(value), MAX_LIMIT);
}

app.http('syncPull', {
  methods: ['POST'],
  // Anonymous at the Functions layer for the same reason as every other route
  // here: SWA linked backends cannot forward a function key. Authorisation is
  // the `authenticated` role on /api/sync/* in staticwebapp.config.json plus
  // requirePrincipal below, which also refuses the untrusted topology.
  authLevel: 'anonymous',
  route: 'sync/pull',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    let userId: string;
    try {
      ({ userId } = requirePrincipal(req));
    } catch (err) {
      if (err instanceof UnauthenticatedError) return json(401, { error: err.message });
      return errorResponse(ctx, 500, 'Could not resolve the caller identity', err);
    }

    let body: PullRequest;
    try {
      body = await readJson<PullRequest>(req);
    } catch {
      body = {};
    }

    const cursor = parseCursor(body.cursor);
    const limit = parseLimit(body.limit);

    try {
      // Bounded by the partition key, so this is a single-partition query and
      // costs a handful of RUs even on a large dataset. The cursor document
      // shares the partition and is excluded explicitly — it has no seq of its
      // own to hand back.
      const { resources } = await getSyncContainer()
        .items.query<SyncDocument>(
          {
            query:
              'SELECT * FROM c WHERE c.userId = @userId AND c.seq > @cursor AND c.id != @cursorId ORDER BY c.seq OFFSET 0 LIMIT @limit',
            parameters: [
              { name: '@userId', value: userId },
              { name: '@cursor', value: cursor },
              { name: '@cursorId', value: CURSOR_ID },
              { name: '@limit', value: limit },
            ],
          },
          { partitionKey: userId },
        )
        .fetchAll();

      const body: PullResponse = {
        records: resources,
        // The highest seq returned, or the request cursor when empty — never a
        // value the client has not actually received, or the gap would be
        // permanent.
        cursor: resources.length > 0 ? resources[resources.length - 1]!.seq : cursor,
        // A full page means there is probably more. The client loops until this
        // is false rather than trusting a count.
        hasMore: resources.length === limit,
      };
      ctx.log('sync pull', { count: resources.length, cursor: body.cursor });
      return json(200, body);
    } catch (err) {
      return errorResponse(ctx, 502, 'Could not read from the sync store', err);
    }
  },
});
