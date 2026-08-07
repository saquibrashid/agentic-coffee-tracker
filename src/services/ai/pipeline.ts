/**
 * The OCR -> parse pipeline, shared by the interactive capture flow and the
 * offline queue runner so both produce identical results.
 *
 * Failure policy (see specs/architecture.md and specs/ux-states.md):
 *  - Network/BFF unreachable, or a 5xx from the BFF -> throw
 *    `PipelineUnavailableError`. The caller queues the work for later; this is
 *    the normal offline path.
 *  - 422 schema violation     -> resolve with `needsReview: true` and the raw
 *    OCR text. Retrying will not help, so it must not be treated as an error.
 */
import { ApiError, isSchemaError, ocr, parse, type ParsedBean } from '@/services/ai';
import { mockOcrFromPhotoBlob } from '@/services/mocks/ocrMock';

/** Raised when the BFF could not be reached at all (offline, dev API not running). */
export class PipelineUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('AI backend unavailable');
    this.name = 'PipelineUnavailableError';
    this.cause = cause;
  }
}

export interface ExtractionResult {
  rawText: string;
  parsed: ParsedBean | null;
  model: string | null;
  /** True when the model output was unusable and the user must fill fields in manually. */
  needsReview: boolean;
  schemaErrors?: string[];
  /**
   * True when any part of this result is synthetic rather than a real read of
   * the photo — either the local mock stood in for an unreachable BFF, or the
   * BFF itself has no AI credentials and answered with fixtures.
   *
   * The UI must never present a `usedMock` result as if it came from the bag.
   */
  usedMock: boolean;
}

/** The BFF reports these when it is running without AI credentials. */
const MOCK_OCR_PROVIDER = 'mock-vision';
const MOCK_PARSE_MODEL = 'mock-model';

/**
 * `true` when the frontend should fall back to local mocks instead of failing.
 * Enabled by default in `pnpm dev` so the UI is usable without `func start`.
 */
const ALLOW_MOCK_FALLBACK =
  (import.meta.env.VITE_ALLOW_MOCK_AI ?? (import.meta.env.DEV ? 'true' : 'false')) === 'true';

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Failed to read image data'));
    reader.readAsDataURL(blob);
  });
}

/**
 * `true` when the failure is worth retrying later: either the request never
 * reached the BFF, or the BFF/upstream faulted (5xx). Client errors (4xx other
 * than 422) are our own bug and must surface immediately.
 */
function isRetryable(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status >= 500;
}

export async function extractBeanFromPhoto(blob: Blob): Promise<ExtractionResult> {
  const imageBase64 = await blobToBase64(blob);

  let rawText: string;
  let usedMock = false;

  try {
    const ocrResponse = await ocr({ imageBase64, mimeType: blob.type || 'image/webp' });
    rawText = ocrResponse.rawText;
    if (ocrResponse.provider === MOCK_OCR_PROVIDER) usedMock = true;
  } catch (err) {
    if (!isRetryable(err)) throw err;
    if (!ALLOW_MOCK_FALLBACK) throw new PipelineUnavailableError(err);
    rawText = mockOcrFromPhotoBlob(blob).rawText;
    usedMock = true;
  }

  try {
    const parseResponse = await parse({ ocrText: rawText });
    return {
      rawText,
      parsed: parseResponse.parsed,
      model: parseResponse.model,
      needsReview: (parseResponse.parsed.confidence ?? 0) < 0.6,
      usedMock: usedMock || parseResponse.model === MOCK_PARSE_MODEL,
    };
  } catch (err) {
    if (isSchemaError(err)) {
      return {
        rawText,
        parsed: null,
        model: err.body.model,
        needsReview: true,
        schemaErrors: err.body.details,
        usedMock,
      };
    }
    if (!isRetryable(err)) throw err;
    if (!ALLOW_MOCK_FALLBACK) throw new PipelineUnavailableError(err);
    return { rawText, parsed: null, model: null, needsReview: true, usedMock: true };
  }
}
