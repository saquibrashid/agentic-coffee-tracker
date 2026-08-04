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

async function apiPost<TResp>(path: string, body: unknown): Promise<TResp> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-app-version': APP_VERSION,
    },
    body: JSON.stringify(body),
  });
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
  provider: 'azure-vision';
  providerVersion?: string;
}
export const ocr = (req: OcrRequest): Promise<OcrResponse> => apiPost('/api/ocr', req);

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

export const parse = (req: ParseRequest): Promise<ParseResponse> => apiPost('/api/parse', req);

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
}
export const scrape = (req: ScrapeRequest): Promise<ScrapeResponse> => apiPost('/api/scrape', req);
