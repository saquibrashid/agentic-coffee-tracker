import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import { resolveSyncCaller } from '../lib/syncAuth.js';
import { deleteUserData } from '../lib/cosmos.js';
import { deleteUserPhotos } from '../lib/blob.js';

/**
 * Removes everything this deployment holds for the caller.
 *
 * `SECURITY.md` listed the absence of this as a gap rather than a guarantee:
 * signing out stopped sync but left the remote copy in place, and removing it
 * meant reaching into the Cosmos and storage accounts by hand. Data a user
 * cannot delete from inside the app is data they have not really consented to
 * store.
 *
 * The local database is untouched. Deleting the cloud copy is a decision about
 * where data lives, not a decision to lose it, and conflating the two would
 * make an already-frightening button destroy more than it says.
 */

interface DeleteRequest {
  /** The caller's own id, typed by the user. See below. */
  confirm?: unknown;
}

export interface DeleteResponse {
  recordsDeleted: number;
  photosDeleted: number;
}

app.http('syncDelete', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'sync/delete',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    const caller = resolveSyncCaller(req, ctx);
    if (!caller.ok) return caller.response;
    const { userId } = caller.principal;

    let body: DeleteRequest;
    try {
      body = await readJson<DeleteRequest>(req);
    } catch {
      return json(400, { error: 'A JSON body with confirm is required' });
    }

    // Server-side confirmation, not merely a UI dialog. This endpoint is
    // reachable by anything holding the session cookie, so the irreversible
    // action needs a deliberate signal in the request itself — otherwise a
    // cross-site request that merely rides the cookie could wipe the account.
    if (body.confirm !== userId) {
      return json(400, { error: 'Confirmation did not match the signed-in account' });
    }

    try {
      // Photos first. A record left pointing at deleted bytes is a broken
      // image; bytes left with no record are invisible and get swept by a
      // retry. Failing in the harmless direction is the point.
      const photosDeleted = await deleteUserPhotos(userId);
      const recordsDeleted = await deleteUserData(userId);

      ctx.log('deleted cloud data', { recordsDeleted, photosDeleted });
      const response: DeleteResponse = { recordsDeleted, photosDeleted };
      return json(200, response);
    } catch (err) {
      // Partial deletion is expected here and is safe to retry: both helpers
      // are loops over what is still present, so a second call resumes rather
      // than repeating work.
      return errorResponse(ctx, 502, 'Could not delete all cloud data', err);
    }
  },
});
