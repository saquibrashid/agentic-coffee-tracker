import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import { errorResponse, json, readJson } from '../lib/http.js';
import { ALLOWED_IMAGE_TYPES, normalizeContentType, sniffImageType } from '../lib/imageType.js';
import { safeFetchBinary, UnsafeUrlError } from '../lib/safeFetch.js';

interface ImageRequest {
  url?: unknown;
}

/**
 * Roaster CDNs do not serve permissive CORS headers, so the browser cannot read
 * a product image directly however public it is. This endpoint fetches it
 * server-side and hands back a data URL the canvas pipeline can consume.
 *
 * It is a deliberately narrow proxy: the same SSRF address checks as `/api/scrape`
 * apply, the response must actually be a bitmap image, and the payload is capped.
 * It cannot be used to launder arbitrary content, because anything that is not a
 * recognised image type is refused rather than passed through.
 */

/**
 * SVG is excluded on purpose. It is an active document — it can carry script —
 * and nothing in the app needs it: the pipeline rasterises to WebP regardless.
 * The allowlist and the byte sniffing both live in `../lib/imageType.js`.
 */

/** Comfortably above a typical product shot, well below the function's memory. */
const MAX_IMAGE_BYTES = 6_000_000;

/**
 * A 96x96 coffee-brown PNG, used for the credential-free mock chain so that
 * bulk import still demonstrates image enrichment offline and in CI.
 */
const MOCK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAAj0lEQVR42u3QMQ0AAAgDsLnCBVbw/+GA' +
  'k6tJFTTTxSEKBAkSJEiQIEGCECRIkCBBggQJQpAgQYIECRIkCEGCBAkSJEiQIEEIEiRIkCBBggQhSJAg' +
  'QYIECRIkCEGCBAkSJEiQIAQJEiRIkCBBghAkSJAgQYIECUKQIEGCBAkSJEgQggQJEiRIkCBBCBIk6M8C' +
  'RNxR/y/EBx0AAAAASUVORK5CYII=';

function isMockHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith('.example');
  } catch {
    return false;
  }
}

/** `image/jpeg; charset=binary` is common enough to be worth tolerating. */

/**
 * Content-Type headers lie, so the bytes are checked too. Only the magic
 * numbers of the formats we accept are recognised.
 */

app.http('image', {
  methods: ['POST'],
  // Anonymous for the same reason as the other endpoints: Static Web Apps
  // linked backends cannot forward a function key, and Easy Auth on the
  // Function App means the Static Web App front door is the only caller.
  authLevel: 'anonymous',
  route: 'image',
  handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await readJson<ImageRequest>(req);
      if (typeof body.url !== 'string') {
        return errorResponse(ctx, 400, 'url is required');
      }

      ctx.log('image invoked', { url: body.url });

      if (isMockHost(body.url)) {
        return json(200, {
          dataUrl: `data:image/png;base64,${MOCK_PNG_BASE64}`,
          contentType: 'image/png',
          byteSize: Buffer.from(MOCK_PNG_BASE64, 'base64').byteLength,
          sourceUrl: body.url,
        });
      }

      const res = await safeFetchBinary(body.url, {
        accept: 'image/*',
        maxBytes: MAX_IMAGE_BYTES,
      });

      if (res.status !== 200) {
        return errorResponse(ctx, 502, `Image fetch returned ${res.status}`);
      }
      if (res.bytes.byteLength === 0) {
        return errorResponse(ctx, 502, 'Image was empty.');
      }

      const declared = normalizeContentType(res.contentType);
      const sniffed = sniffImageType(res.bytes);
      // The header is only trusted when the bytes agree with it. A mislabelled
      // response is treated as whatever it actually is, and a response that is
      // not an image at all is refused.
      if (!sniffed || !ALLOWED_IMAGE_TYPES.has(sniffed)) {
        return errorResponse(
          ctx,
          415,
          declared ? `Unsupported image type: ${declared}` : 'That URL is not an image.',
        );
      }

      return json(200, {
        dataUrl: `data:${sniffed};base64,${res.bytes.toString('base64')}`,
        contentType: sniffed,
        byteSize: res.bytes.byteLength,
        sourceUrl: res.finalUrl,
      });
    } catch (err) {
      if (err instanceof UnsafeUrlError) return errorResponse(ctx, 400, err.message, err);
      return errorResponse(ctx, 500, 'Image fetch failed', err);
    }
  },
});
