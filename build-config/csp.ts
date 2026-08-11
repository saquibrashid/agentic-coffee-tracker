import { createHash } from 'node:crypto';

/**
 * Builds the Content Security Policy the app ships with.
 *
 * The policy is generated rather than written out as a literal because two of
 * its values are not knowable when the file is written: the hash of the inline
 * theme script (which changes whenever that script is edited) and the photo
 * storage account name (which contains a per-environment token). A literal
 * would be wrong the first time either changed, and wrong silently — a CSP
 * failure surfaces as a feature that quietly stops working, not as an error the
 * build can catch.
 */

export interface CspOptions {
  /**
   * Base64 sha256 digests of every inline `<script>` in the served HTML.
   *
   * Exactly one today: the anti-FOUC theme script in `index.html`, which has to
   * be inline and synchronous to beat the first paint.
   */
  scriptHashes: readonly string[];

  /**
   * Photo storage account name, e.g. `stphotof4n7ptoeq44pk`.
   *
   * Photo bytes go direct to Blob Storage with a SAS URL, so this is a genuine
   * cross-origin `connect-src`. Absent on deployments without a linked backend,
   * where photos never leave the device.
   */
  photoStorageAccount?: string | undefined;

  /**
   * `VITE_API_BASE_URL`, when the BFF is a separate origin.
   *
   * Empty on the linked-backend topology, where `/api/*` is same-origin and
   * already covered by `'self'`.
   */
  apiBaseUrl?: string | undefined;

  /**
   * Relaxes the policy for the Vite dev server.
   *
   * See `scriptSrc` below for why this cannot simply be "the real policy plus
   * some extras".
   */
  dev?: boolean;
}

/** Base64 sha256 of a script body, in the form CSP expects. */
export function hashInlineScript(source: string): string {
  return `sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}`;
}

function connectSrc(options: CspOptions): string[] {
  // `'self'` already covers `/api/*` and `/.auth/*` on the linked-backend
  // topology, which is what production runs.
  const sources = ["'self'"];

  if (options.apiBaseUrl) sources.push(options.apiBaseUrl);

  if (options.photoStorageAccount) {
    sources.push(`https://${options.photoStorageAccount}.blob.core.windows.net`);
  }

  // Vite's HMR channel. Both schemes, because the dev server is plain http
  // locally but may be https behind a tunnel.
  if (options.dev) sources.push('ws:', 'wss:');

  return sources;
}

function scriptSrc(options: CspOptions): string[] {
  // Dev deliberately uses `'unsafe-inline'` *instead of* the hashes, not as
  // well as them. A browser ignores `'unsafe-inline'` entirely once any hash or
  // nonce is present — a CSP2 rule that exists to stop a stale allowance
  // silently widening a hash-based policy. Listing both would therefore block
  // the inline preamble `@vitejs/plugin-react` injects, and the dev server
  // would break in a way that looks nothing like a CSP problem.
  if (options.dev) return ["'self'", "'unsafe-inline'"];

  return ["'self'", ...options.scriptHashes.map((hash) => `'${hash}'`)];
}

function styleSrc(options: CspOptions): string[] {
  // Vite serves CSS as injected `<style>` elements in dev; the production build
  // links a stylesheet instead, so only dev needs the allowance.
  return options.dev ? ["'self'", "'unsafe-inline'"] : ["'self'"];
}

export function buildCsp(options: CspOptions): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrc(options),

    // No `'unsafe-inline'` in production. The bundle ships CSS as a linked
    // stylesheet and nothing creates a `<style>` element at runtime — checked
    // against the built output, and confirmed by the CSP e2e suite, which sees
    // no `style-src` violation on any route. React's `style={{}}` and the theme
    // script's `documentElement.style` both go through CSSOM, which CSP does
    // not govern.
    'style-src': styleSrc(options),

    // `data:` for the thumbnails stored on each bean record, `blob:` for full
    // photos rendered out of IndexedDB via `URL.createObjectURL`. Remote
    // roaster images need no allowance: they are fetched server-side by
    // `/api/image` and returned as data URLs, so the browser never requests a
    // third-party host.
    'img-src': ["'self'", 'data:', 'blob:'],

    'font-src': ["'self'"],
    'connect-src': connectSrc(options),

    // Workbox registers the service worker from the app's own origin.
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],

    // Hardening that costs nothing here: the app embeds no plugins, frames
    // nothing, is framed by nothing, and posts no forms cross-origin.
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };

  return Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');
}
