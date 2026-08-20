/**
 * Thin client for the BFF endpoints described in specs/architecture.md.
 * All requests share an `x-app-version` header for telemetry/deprecation.
 *
 * NOTE: Implementations are stubbed until the BFF is wired up. Throwing here
 * surfaces missing wiring loudly during integration; real implementations will
 * call into `apiPost` once endpoints respond.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const APP_VERSION = '0.1.0';

/**
 * Ceiling on a single BFF call. Without one, an unreachable or wedged backend
 * leaves the request pending forever: the queue runner awaits it while holding
 * the `queue-runner` Web Lock, so every later interval tick is a no-op and the
 * whole offline reconciliation loop stalls until the tab is closed. A timeout
 * converts that into an ordinary retryable failure with backoff.
 */
const DEFAULT_TIMEOUT_MS = 20_000;
/** Model-backed endpoints legitimately take longer than a plain HTTP hop. */
const MODEL_TIMEOUT_MS = 60_000;
/**
 * Image generation is slower again — a re-shoot takes tens of seconds, where a
 * text completion that slow would already be a failure.
 *
 * The ceiling is nonetheless *below* a minute, because Static Web Apps gives up
 * on a linked-backend call at 45 seconds and answers `Backend call failure`
 * itself. Waiting past that point cannot produce anything but a longer wait
 * before the same failure, so the request is abandoned just after the front
 * door would have abandoned it.
 */
const STUDIO_PHOTO_TIMEOUT_MS = 50_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A call that never came back. Transient by definition, so callers retry it. */
export class ApiTimeoutError extends Error {
  constructor(
    readonly path: string,
    readonly timeoutMs: number,
  ) {
    super(`POST ${path} timed out after ${timeoutMs}ms`);
    this.name = 'ApiTimeoutError';
  }
}

async function apiPost<TResp>(
  path: string,
  body: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<TResp> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-app-version': APP_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new ApiTimeoutError(path, timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let payload: unknown;
    try {
      payload = (await res.json()) as unknown;
    } catch {
      payload = await res.text();
    }
    throw new ApiError(`POST ${path} -> ${res.status}`, res.status, payload);
  }
  return (await res.json()) as TResp;
}

// ---- OCR ----
export interface OcrRequest {
  imageBase64: string;
  mimeType: string;
}
export interface OcrResponse {
  rawText: string;
  /** `mock-vision` means the BFF has no Azure AI Vision credentials and returned a fixture. */
  provider: 'azure-vision' | 'mock-vision';
  providerVersion?: string;
}
export const ocr = (req: OcrRequest): Promise<OcrResponse> =>
  apiPost('/api/ocr', req, MODEL_TIMEOUT_MS);

// ---- Parse ----
export interface ParseRequest {
  ocrText: string;
  model?: string;
}

/** Mirrors the LLM output contract in specs/data-model.md. */
export interface ParsedOrigin {
  country: string | null;
  region: string | null;
  farm: string | null;
  producer: string | null;
  percentage: number | null;
}
export interface ParsedBean {
  roaster: string | null;
  name: string | null;
  origins: ParsedOrigin[];
  process: 'washed' | 'natural' | 'honey' | 'anaerobic' | 'wet-hulled' | 'other' | null;
  roastLevel: 'light' | 'medium-light' | 'medium' | 'medium-dark' | 'dark' | null;
  tastingNotes: string[];
  roastDate: string | null;
  varietals: string[];
  elevationMeters: { min: number | null; max: number | null } | null;
  roasterDescription: string | null;
  confidence: number;
}
export interface ParseResponse {
  parsed: ParsedBean;
  model: string;
  rawText: string;
}

/** Body returned by `/api/parse` with HTTP 422 when the model breaks the schema. */
export interface ParseSchemaErrorBody {
  error: string;
  details: string[];
  model: string;
  rawText: string;
}

/**
 * `/api/parse` answers 422 when the model's JSON does not match the schema. That
 * is an expected outcome, not a bug: callers should fall back to manual entry
 * with `needsReview = true` rather than treating it as a transient failure.
 */
export function isSchemaError(err: unknown): err is ApiError & { body: ParseSchemaErrorBody } {
  return err instanceof ApiError && err.status === 422;
}

export const parse = (req: ParseRequest): Promise<ParseResponse> =>
  apiPost('/api/parse', req, MODEL_TIMEOUT_MS);

// ---- Search ----
export interface SearchRequest {
  roaster: string;
  name: string;
  max?: number;
}
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}
export interface SearchResponse {
  results: SearchResult[];
}
export const search = (req: SearchRequest): Promise<SearchResponse> => apiPost('/api/search', req);

// ---- Scrape ----
export interface ScrapeRequest {
  url: string;
}
export interface ScrapeResponse {
  extracted: Record<string, unknown>;
  sourceUrl: string;
  /** The product image found on the page, when there was one. */
  imageUrl?: string;
}
export const scrape = (req: ScrapeRequest): Promise<ScrapeResponse> => apiPost('/api/scrape', req);

// ---- Image ----
export interface ImageRequest {
  url: string;
}
export interface ImageResponse {
  /** The image as a data URL, ready for the canvas resize pipeline. */
  dataUrl: string;
  contentType: string;
  byteSize: number;
  sourceUrl: string;
}
/**
 * Fetched through the BFF rather than the browser: roaster CDNs do not send
 * permissive CORS headers, so a direct `fetch` from the page is blocked however
 * public the image is.
 */
export const fetchImage = (req: ImageRequest): Promise<ImageResponse> => apiPost('/api/image', req);

// ---- Studio photo ----
export interface StudioPhotoRequest {
  /** Base64 bytes of the existing photo, without the data URL prefix. */
  imageBase64: string;
  mimeType: string;
}
export interface StudioPhotoResponse {
  /** The generated image as a data URL, ready for the canvas resize pipeline. */
  dataUrl: string;
  contentType: string;
  byteSize: number;
  /** `mock-image` means the BFF has no image deployment and echoed the source back. */
  provider: 'azure-mai' | 'mock-image';
  model?: string;
}
/**
 * Re-shoots a bag photo as a studio product shot.
 *
 * Slower and more expensive than every other endpoint — a generation runs to
 * tens of seconds and is billed per image — so it gets the long timeout and is
 * never called without the user having asked for it.
 *
 * What comes back is decoration. The model can alter a logo or a word, so the
 * result is stored as a `bag-studio` photo and kept away from every path that
 * reads details off a picture. See `services/enrich/studioPhoto.ts`.
 */
export const generateStudioPhoto = (req: StudioPhotoRequest): Promise<StudioPhotoResponse> =>
  apiPost('/api/studio-photo', req, STUDIO_PHOTO_TIMEOUT_MS);

// ---- Recommend ----
export interface RankedSummaryItem {
  value: string;
  count: number;
  averageScore: number;
}
export interface PreferenceSummary {
  favoriteOrigins: RankedSummaryItem[];
  favoriteRoasters: RankedSummaryItem[];
  favoriteProcesses: RankedSummaryItem[];
  favoriteRoastLevels: RankedSummaryItem[];
  favoriteFlavors: RankedSummaryItem[];
  favoriteBrewTypes: RankedSummaryItem[];
  averageScore: number;
  totalRatings: number;
}
export interface GroundedProduct {
  roaster: string;
  name: string;
  url: string;
  /** When the listing was last seen. Not a stock check. */
  verifiedAt: string;
}
export interface Recommendation {
  title: string;
  rationale: string;
  basedOn: string[];
  origin: string | null;
  roastLevel: string | null;
  process: string | null;
  flavorNotes: string[];
  /** Present only when the suggestion is a specific coffee on a real store page. */
  product?: GroundedProduct;
}
export interface RecommendRequest {
  preferences: PreferenceSummary;
  max?: number;
}
export interface RecommendResponse {
  recommendations: Recommendation[];
  model: string;
  /** Whether the set came from real, cited product pages. */
  grounded?: boolean;
  reason?: 'insufficient-history';
}
export const recommend = (req: RecommendRequest): Promise<RecommendResponse> =>
  apiPost('/api/recommend', req, MODEL_TIMEOUT_MS);
