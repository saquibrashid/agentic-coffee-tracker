import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import { ALLOWED_IMAGE_TYPES, sniffImageType } from '../lib/imageType.js';
import { callImageEdit, getOpenAiImageConfig, OpenAiError } from '../lib/openai.js';
import { consume, IMAGE_RATE_LIMIT } from '../lib/rateLimit.js';
import { STUDIO_PHOTO_PROMPT } from '../lib/studioPrompt.js';

interface StudioPhotoRequest {
  imageBase64?: unknown;
  mimeType?: unknown;
}

/**
 * Re-shoots a bag photo as a studio product photograph.
 *
 * The packaging is meant to survive untouched and only the presentation to
 * change — see `../lib/studioPrompt.ts` for the instruction and why its wording
 * is load-bearing. What comes back is **decoration**: the model can quietly
 * alter a logo or a word, so the client marks the result as generated, keeps
 * the original bytes, and never feeds a generated image to OCR or `/api/parse`.
 *
 * Two things distinguish this from the other model endpoints:
 *
 *  - **It costs real money per call.** Every other endpoint is cheap enough to
 *    run unattended over a whole library; this one is not, so it is rate
 *    limited on its own much tighter budget rather than the sync one.
 *  - **It returns bytes, not text.** They are handed back as a data URL because
 *    `img-src` is `'self' data: blob:` — a model-hosted temporary URL could
 *    never be rendered by the app even if it were durable.
 */

/** Matches `/api/image`: comfortably above a bag shot, well below the memory cap. */
const MAX_IMAGE_BYTES = 6_000_000;

/**
 * Bucket key for the rate limiter.
 *
 * These endpoints are anonymous — Static Web Apps linked backends cannot
 * forward a function key — so there is no verified identity to charge. The
 * principal header is used when the front door supplied one, purely so that one
 * user's bulk re-shoot does not spend everybody else's budget, and falls back to
 * a shared bucket otherwise. This is a cost control, not a security control;
 * `lib/rateLimit.ts` explains why that distinction is acceptable here.
 */
function budgetKey(req: HttpRequest): string {
  const header = req.headers.get('x-ms-client-principal');
  if (!header) return 'anonymous';
  try {
    const raw = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as { userId?: unknown };
    return typeof raw.userId === 'string' && raw.userId !== '' ? `image:${raw.userId}` : 'anonymous';
  } catch {
    return 'anonymous';
  }
}

app.http('studioPhoto', {
  methods: ['POST'],
  // Anonymous for the same reason as the other endpoints: Static Web Apps
  // linked backends cannot forward a function key, and Easy Auth on the
  // Function App means the Static Web App front door is the only caller.
  authLevel: 'anonymous',
  route: 'studio-photo',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await readJson<StudioPhotoRequest>(req);
      if (typeof body.imageBase64 !== 'string' || typeof body.mimeType !== 'string') {
        return errorResponse(ctx, 400, 'imageBase64 and mimeType are required strings');
      }

      const bytes = Buffer.from(body.imageBase64, 'base64');
      if (bytes.byteLength === 0) return errorResponse(ctx, 400, 'imageBase64 was empty.');
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        return errorResponse(ctx, 413, 'That image is too large to re-shoot.');
      }

      // The declared type is not trusted, exactly as in `/api/image`: what gets
      // uploaded to the model is whatever the bytes actually are.
      const sniffed = sniffImageType(bytes);
      if (!sniffed || !ALLOWED_IMAGE_TYPES.has(sniffed)) {
        return errorResponse(ctx, 415, 'That is not an image we can re-shoot.');
      }

      const limit = consume(budgetKey(req), IMAGE_RATE_LIMIT);
      if (!limit.allowed) {
        ctx.warn('studio-photo rate limit', { retryAfterSeconds: limit.retryAfterSeconds });
        return {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': String(limit.retryAfterSeconds),
          },
          body: JSON.stringify({ error: 'Too many photos at once. Try again shortly.' }),
        };
      }

      ctx.log('studio-photo invoked', { mimeType: sniffed, bytes: bytes.byteLength });

      const config = getOpenAiImageConfig();
      if (!config) {
        // Mock fallback, following the `/api/image` precedent. The source image
        // is echoed back rather than a fixture substituted: it is a real,
        // decodable image of the right shape, so the whole client pipeline —
        // staging, previewing, accepting, reverting — is exercisable in CI and
        // offline without a deployment. `provider` is what tells the caller the
        // picture was not actually re-shot.
        return json(200, {
          dataUrl: `data:${sniffed};base64,${bytes.toString('base64')}`,
          contentType: sniffed,
          byteSize: bytes.byteLength,
          provider: 'mock-image',
        });
      }

      const result = await callImageEdit(config, {
        image: bytes,
        imageContentType: sniffed,
        prompt: STUDIO_PHOTO_PROMPT,
      });

      return json(200, {
        dataUrl: `data:${result.contentType};base64,${result.bytes.toString('base64')}`,
        contentType: result.contentType,
        byteSize: result.bytes.byteLength,
        provider: 'azure-openai',
        model: result.model,
      });
    } catch (err) {
      // A refusal or a content filter is the model declining this particular
      // picture, and it will decline it identically forever. Passing the status
      // through lets the client stop rather than retry an hour at a time.
      if (err instanceof OpenAiError && err.status >= 400 && err.status < 500) {
        return errorResponse(ctx, 422, 'The model would not re-shoot that photo.', err);
      }
      return errorResponse(ctx, 500, 'Could not re-shoot that photo', err);
    }
  },
});
