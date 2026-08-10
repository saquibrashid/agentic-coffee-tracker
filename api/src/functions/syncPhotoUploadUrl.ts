import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import { UnauthenticatedError, requirePrincipal } from '../lib/principal.js';
import { ForbiddenError, requireAccess } from '../lib/access.js';
import { PHOTO_QUOTA_BYTES, fitsQuota, grantUpload, isSafeId, usedBytes } from '../lib/blob.js';

/**
 * Issues a short-lived, write-only credential for one photo blob.
 *
 * `specs/sync.md` -> Photos requires the blob to land *before* its metadata
 * record. The reverse order publishes a pointer to bytes that do not exist yet,
 * and every other device that pulls in that window renders a broken photo.
 */

interface UploadUrlRequest {
  photoId?: unknown;
  bytes?: unknown;
}

export interface UploadUrlResponse {
  url: string;
  expiresAt: string;
  quota: { used: number; limit: number };
}

app.http('syncPhotoUploadUrl', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'sync/photo/upload-url',
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

    let body: UploadUrlRequest;
    try {
      body = await readJson<UploadUrlRequest>(req);
    } catch {
      return json(400, { error: 'A JSON body with photoId and bytes is required' });
    }

    const { photoId, bytes } = body;
    if (typeof photoId !== 'string' || !isSafeId(photoId)) {
      return json(400, { error: 'photoId must be a simple identifier' });
    }
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
      return json(400, { error: 'bytes must be a positive number' });
    }

    try {
      const used = await usedBytes(userId);
      if (!fitsQuota(used, bytes)) {
        // 507 rather than 403: the request is legitimate and the caller is
        // authorised — there is simply no room. The client surfaces this in
        // Settings and keeps syncing records, which must never be blocked by a
        // photo problem.
        ctx.log('photo quota exceeded', { used, requested: bytes });
        return json(507, {
          error: 'Photo storage is full. Delete some photos to free up space.',
          quota: { used, limit: PHOTO_QUOTA_BYTES },
        });
      }

      const grant = await grantUpload(userId, photoId);
      const response: UploadUrlResponse = {
        ...grant,
        quota: { used, limit: PHOTO_QUOTA_BYTES },
      };
      return json(200, response);
    } catch (err) {
      return errorResponse(ctx, 502, 'Could not prepare the photo upload', err);
    }
  },
});
