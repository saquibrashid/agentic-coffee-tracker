import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import { UnauthenticatedError, requirePrincipal } from '../lib/principal.js';
import { ForbiddenError, requireAccess } from '../lib/access.js';
import { grantDownload, isSafeId, photoExists } from '../lib/blob.js';

/**
 * Issues a short-lived, read-only credential for one photo blob.
 *
 * Downloads are lazy (`specs/sync.md` -> Photos): a freshly signed-in device
 * renders its whole library from bean thumbnails alone, and full-resolution
 * bytes arrive behind that. This endpoint is what each of those fetches asks
 * for.
 */

interface DownloadUrlRequest {
  photoId?: unknown;
}

export interface DownloadUrlResponse {
  url: string;
  expiresAt: string;
}

app.http('syncPhotoDownloadUrl', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'sync/photo/download-url',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    let userId: string;
    try {
      const principal = requirePrincipal(req);
      requireAccess(principal);
      ({ userId } = principal);
    } catch (err) {
      if (err instanceof UnauthenticatedError) return json(401, { error: err.message });
      if (err instanceof ForbiddenError) return json(403, { error: err.message });
      return errorResponse(ctx, 500, 'Could not resolve the caller identity', err);
    }

    let body: DownloadUrlRequest;
    try {
      body = await readJson<DownloadUrlRequest>(req);
    } catch {
      return json(400, { error: 'A JSON body with photoId is required' });
    }

    const { photoId } = body;
    if (typeof photoId !== 'string' || !isSafeId(photoId)) {
      return json(400, { error: 'photoId must be a simple identifier' });
    }

    try {
      // The blob path is derived from the *caller's* id, so a signed URL can
      // only ever address the caller's own blob. Checking existence first turns
      // "uploaded from a device that never finished" into a clean 404 rather
      // than a SAS URL that 404s later, out of context, inside an image fetch.
      if (!(await photoExists(userId, photoId))) {
        return json(404, { error: 'No bytes stored for that photo' });
      }

      const grant = await grantDownload(userId, photoId);
      const response: DownloadUrlResponse = grant;
      return json(200, response);
    } catch (err) {
      return errorResponse(ctx, 502, 'Could not prepare the photo download', err);
    }
  },
});
