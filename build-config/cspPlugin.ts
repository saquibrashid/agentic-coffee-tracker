import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Plugin, ResolvedConfig } from 'vite';

import { buildCsp, hashInlineScript } from './csp';

/**
 * Emits the Content Security Policy into the Static Web Apps config.
 *
 * The header cannot live in `public/staticwebapp.config.json` as a literal: it
 * carries the hash of the inline theme script, which changes whenever that
 * script is edited. Hand-maintaining it would mean a stale hash blanks the page
 * on first paint, with nothing in the build to say so. The hash is therefore
 * taken from the HTML this build actually produced.
 */

/**
 * Matches inline `<script>` elements, i.e. those with no `src`.
 *
 * The `src` test requires preceding whitespace rather than a word boundary.
 * `\bsrc=` looks equivalent but is not: `-` to `s` *is* a word boundary, so
 * `<script data-src="…">` would satisfy the negative lookahead, and its inline
 * body would be skipped — producing a policy that blocks a script the page
 * needs, with a build that reported success.
 */
const INLINE_SCRIPT = /<script(?![^>]*\ssrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

/** Digests of every inline `<script>` body in the emitted HTML. */
export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(INLINE_SCRIPT)]
    .map((match) => match[1] ?? '')
    .filter((body) => body.trim() !== '')
    .map((body) => hashInlineScript(body));
}

export interface CspPluginOptions {
  photoStorageAccount?: string | undefined;
  apiBaseUrl?: string | undefined;
}

export function cspPlugin(options: CspPluginOptions = {}): Plugin {
  let config: ResolvedConfig;

  return {
    name: 'coffee-app:csp',
    apply: 'build',

    configResolved(resolved) {
      config = resolved;
    },

    // Deliberately `closeBundle` reading from disk, rather than `generateBundle`
    // reading the in-memory bundle. Vite processes HTML in its own
    // `generateBundle`, so a plugin that inspects the HTML there races the
    // plugin that produces it — the first attempt at this collected zero hashes
    // and (correctly) failed the build. By `closeBundle` everything has been
    // written, and hashing the file on disk is exactly what the browser sees.
    closeBundle() {
      const outDir = path.resolve(config.root, config.build.outDir);
      const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
      const hashes = inlineScriptHashes(html);

      // A build that emitted no hash would produce a policy that blocks the
      // theme script. The failure mode is a white flash on every load for
      // dark-mode users — cosmetic enough to ship unnoticed, so fail loudly.
      if (hashes.length === 0) {
        this.error('CSP: no inline script hashes were collected from index.html.');
      }

      // `public/` was copied verbatim, so the config file is already there;
      // this rewrites it with the same content plus the header.
      const configPath = path.join(outDir, 'staticwebapp.config.json');
      const swaConfig = JSON.parse(readFileSync(configPath, 'utf8')) as {
        globalHeaders?: Record<string, string>;
      } & Record<string, unknown>;

      swaConfig.globalHeaders = {
        ...swaConfig.globalHeaders,
        'content-security-policy': buildCsp({ ...options, scriptHashes: hashes }),
      };

      writeFileSync(configPath, `${JSON.stringify(swaConfig, null, 2)}\n`);
    },
  };
}
