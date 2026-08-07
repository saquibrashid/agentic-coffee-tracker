import { lookup } from 'node:dns/promises';

/**
 * Fetching a URL that a language model proposed, or that a user pasted, means
 * fetching an attacker-influenceable address from inside Azure. A hostname
 * allowlist is the obvious guard, but it is the wrong one here: the whole point
 * of enrichment is to read arbitrary roaster storefronts, and an allowlist of
 * the handful of roasters we thought of at build time makes the feature useless.
 *
 * So the guard is on the *address* instead of the name. Anything that resolves
 * into a private, loopback, or link-local range is refused, which is what
 * actually stops SSRF: the Azure instance metadata endpoint (169.254.169.254),
 * localhost admin surfaces, and anything else inside the network boundary.
 * Every redirect hop is re-checked, because a public host is free to redirect
 * to a private one.
 */

const MAX_REDIRECTS = 4;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 15_000;

export const USER_AGENT =
  'AgenticCoffeeBot/0.1 (+https://github.com/saquibrashid/agentic-coffee-tracker)';

export class UnsafeUrlError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'UnsafeUrlError';
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** CIDR blocks that must never be reachable from a user-supplied URL. */
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // RFC 1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — includes the Azure IMDS endpoint
  ['172.16.0.0', 12], // RFC 1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC 1918
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
];

function isBlockedIpv4(ip: string): boolean {
  const addr = ipv4ToInt(ip);
  if (addr === null) return true;
  return BLOCKED_V4.some(([base, bits]) => {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (addr & mask) >>> 0 === (baseInt & mask) >>> 0;
  });
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0] ?? '';
  // IPv4-mapped (::ffff:127.0.0.1) must be judged by its IPv4 rules.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1]);
  if (addr === '::' || addr === '::1') return true;
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  if (addr.startsWith('ff')) return true; // multicast
  return false;
}

export function isBlockedAddress(ip: string, family: number): boolean {
  return family === 6 ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

/**
 * Throws unless every address the hostname resolves to is publicly routable.
 * All addresses are checked, not just the first: a hostname that resolves to
 * both a public and a private address is a classic DNS-rebinding shape.
 */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('That does not look like a valid URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsafeUrlError('Only http and https URLs can be fetched.');
  }
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    throw new UnsafeUrlError('Only the default http and https ports can be fetched.');
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new UnsafeUrlError('That host could not be resolved.');
  }
  if (addresses.length === 0) throw new UnsafeUrlError('That host could not be resolved.');
  if (addresses.some((a) => isBlockedAddress(a.address, a.family))) {
    throw new UnsafeUrlError('That host resolves to a private address.');
  }

  return url;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  body: string;
  contentType: string;
}

export interface SafeFetchBinaryResult {
  finalUrl: string;
  status: number;
  bytes: Buffer;
  contentType: string;
}

/**
 * Fetches a URL with redirects followed manually so that every hop gets the
 * same address check as the original, and with the response body capped so a
 * hostile or merely enormous page cannot exhaust the function's memory.
 */
export async function safeFetch(
  raw: string,
  init: { accept?: string } = {},
): Promise<SafeFetchResult> {
  const res = await safeFetchBytes(raw, {
    accept: init.accept ?? 'text/html,application/xhtml+xml',
    maxBytes: MAX_BYTES,
  });
  return {
    finalUrl: res.finalUrl,
    status: res.status,
    body: new TextDecoder().decode(res.bytes),
    contentType: res.contentType,
  };
}

/**
 * The same guarantees as `safeFetch`, but the body is handed back as bytes.
 *
 * Decoding an image as UTF-8 text and re-encoding it would corrupt it, so
 * anything binary has to take this path. The cap is separate because an image
 * is legitimately larger than the page that referenced it.
 */
export async function safeFetchBinary(
  raw: string,
  init: { accept?: string; maxBytes?: number } = {},
): Promise<SafeFetchBinaryResult> {
  return safeFetchBytes(raw, {
    accept: init.accept ?? '*/*',
    maxBytes: init.maxBytes ?? MAX_BYTES,
  });
}

async function safeFetchBytes(
  raw: string,
  init: { accept: string; maxBytes: number },
): Promise<SafeFetchBinaryResult> {
  let current = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertSafeUrl(current);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': USER_AGENT,
        accept: init.accept,
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new UnsafeUrlError('Redirect without a destination.');
      current = new URL(location, url).toString();
      continue;
    }

    return {
      finalUrl: url.toString(),
      status: res.status,
      bytes: await readCapped(res, init.maxBytes),
      contentType: res.headers.get('content-type') ?? '',
    };
  }

  throw new UnsafeUrlError('Too many redirects.');
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
        break;
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}
