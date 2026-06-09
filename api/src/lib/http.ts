import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

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

export function errorResponse(
  ctx: InvocationContext,
  status: number,
  message: string,
  err?: unknown,
): HttpResponseInit {
  ctx.error(message, err instanceof Error ? { name: err.name, message: err.message } : err);
  return json(status, { error: message });
}

export async function readJson<T>(req: HttpRequest): Promise<T> {
  return (await req.json()) as T;
}
