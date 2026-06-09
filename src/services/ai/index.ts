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
export interface ParseResponse {
  parsed: Record<string, unknown>; // shape matches LLM schema in specs/data-model.md
  model: string;
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
