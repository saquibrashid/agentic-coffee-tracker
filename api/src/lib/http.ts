import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { statusForUpstream, UpstreamError } from './upstreamError.js';

const ENV = process.env;

export function requireEnv(name: string): string {
  const value = ENV[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function json(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * The one place a failure becomes a response.
 *
 * The status a route asks for is a *fallback*, not a decision. Every route that
 * calls a model wraps its work in one blanket `catch` and asks for 500, which
 * was right for our own bugs and wrong for everything else: a throttled model
 * came back to the app as `POST /api/parse -> 500`, indistinguishable from a
 * crash, when the honest answer was "busy, come back shortly". Mapping here
 * rather than in each route means no route can forget.
 *
 * The message stays generic on purpose. Upstream bodies quote our deployment
 * names and region, which the caller has no use for; the detail goes to the log.
 */
export function errorResponse(
  ctx: InvocationContext,
  status: number,
  message: string,
  err?: unknown,
): HttpResponseInit {
  ctx.error(message, err instanceof Error ? { name: err.name, message: err.message } : err);
  const mapped = statusForUpstream(err, status);
  const retryAfter = err instanceof UpstreamError ? err.retryAfterSeconds : undefined;
  const response = json(mapped, { error: message });
  if (retryAfter !== undefined && (mapped === 429 || mapped === 503)) {
    response.headers = { ...response.headers, 'retry-after': String(retryAfter) };
  }
  return response;
}

export async function readJson<T>(req: HttpRequest): Promise<T> {
  return (await req.json()) as T;
}
