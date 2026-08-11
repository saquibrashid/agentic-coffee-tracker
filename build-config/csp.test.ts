import { describe, expect, it } from 'vitest';

import { buildCsp, hashInlineScript } from './csp';
import { inlineScriptHashes } from './cspPlugin';

/** Pulls one directive's sources out of a policy string. */
function directive(policy: string, name: string): string[] {
  const found = policy
    .split('; ')
    .find((part) => part.startsWith(`${name} `))
    ?.slice(name.length + 1);
  return found ? found.split(' ') : [];
}

const HASH = 'sha256-abc123';

describe('buildCsp', () => {
  it('allows the inline theme script by hash rather than by blanket permission', () => {
    const policy = buildCsp({ scriptHashes: [HASH] });

    expect(directive(policy, 'script-src')).toEqual(["'self'", `'${HASH}'`]);
  });

  it('never allows inline script in a production policy', () => {
    // The single most valuable thing this policy does. An `'unsafe-inline'`
    // that crept in would leave the header looking complete while permitting
    // exactly the injection it exists to stop.
    const policy = buildCsp({ scriptHashes: [HASH] });

    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
  });

  it('uses unsafe-inline *instead of* hashes in dev, never alongside', () => {
    // Not a style preference. A browser ignores `'unsafe-inline'` as soon as any
    // hash is present, so a policy listing both would silently block the inline
    // preamble `@vitejs/plugin-react` injects — and the dev server would break
    // in a way that looks nothing like a CSP problem.
    const policy = buildCsp({ scriptHashes: [HASH], dev: true });
    const scriptSrc = directive(policy, 'script-src');

    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc.some((source) => source.includes('sha256-'))).toBe(false);
  });

  it('permits data and blob images, which the app cannot render without', () => {
    // Thumbnails are data URLs on the bean record; full photos come out of
    // IndexedDB via `createObjectURL`. A blocked image is blank space, not an
    // error, so this is worth pinning.
    expect(directive(buildCsp({ scriptHashes: [HASH] }), 'img-src')).toEqual([
      "'self'",
      'data:',
      'blob:',
    ]);
  });

  it('does not allow remote image hosts', () => {
    // Roaster images are fetched server-side by `/api/image` and returned as
    // data URLs, so the browser never requests a third-party host. If that ever
    // changes this test should fail and force the decision to be explicit.
    expect(directive(buildCsp({ scriptHashes: [HASH] }), 'img-src')).not.toContain('https:');
  });

  it('adds the photo storage account to connect-src when there is one', () => {
    const policy = buildCsp({ scriptHashes: [HASH], photoStorageAccount: 'stphotoabc' });

    expect(directive(policy, 'connect-src')).toContain('https://stphotoabc.blob.core.windows.net');
  });

  it('omits blob storage entirely when photos never leave the device', () => {
    // A deployment without a linked backend has no storage account, and naming
    // one would widen the policy to an origin the app cannot use.
    expect(directive(buildCsp({ scriptHashes: [HASH] }), 'connect-src')).toEqual(["'self'"]);
  });

  it('adds the BFF origin only when it is a separate one', () => {
    const separate = buildCsp({
      scriptHashes: [HASH],
      apiBaseUrl: 'https://func-x.azurewebsites.net',
    });
    expect(directive(separate, 'connect-src')).toContain('https://func-x.azurewebsites.net');

    // On the linked-backend topology `/api/*` is same-origin, so `'self'` is
    // the whole answer.
    const linked = buildCsp({ scriptHashes: [HASH], apiBaseUrl: '' });
    expect(directive(linked, 'connect-src')).toEqual(["'self'"]);
  });

  it('allows the HMR socket in dev only', () => {
    expect(directive(buildCsp({ scriptHashes: [], dev: true }), 'connect-src')).toContain('ws:');
    expect(directive(buildCsp({ scriptHashes: [HASH] }), 'connect-src')).not.toContain('ws:');
  });

  it('permits the service worker, which the app is offline-first without', () => {
    expect(directive(buildCsp({ scriptHashes: [HASH] }), 'worker-src')).toEqual(["'self'"]);
  });

  it('locks down the directives that cost nothing to lock down', () => {
    const policy = buildCsp({ scriptHashes: [HASH] });

    expect(directive(policy, 'object-src')).toEqual(["'none'"]);
    expect(directive(policy, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(policy, 'base-uri')).toEqual(["'self'"]);
    expect(directive(policy, 'form-action')).toEqual(["'self'"]);
  });

  it('keeps style-src strict in production and relaxes it only for dev', () => {
    // Production ships CSS as a linked stylesheet and nothing injects a
    // `<style>` element at runtime; Vite does inject one per module in dev.
    expect(directive(buildCsp({ scriptHashes: [HASH] }), 'style-src')).toEqual(["'self'"]);
    expect(directive(buildCsp({ scriptHashes: [], dev: true }), 'style-src')).toContain(
      "'unsafe-inline'",
    );
  });
});

describe('inlineScriptHashes', () => {
  it('hashes an inline script', () => {
    const html = '<html><head><script>console.log(1)</script></head></html>';

    expect(inlineScriptHashes(html)).toEqual([hashInlineScript('console.log(1)')]);
  });

  it('ignores scripts with a src, which are covered by self', () => {
    const html = '<script type="module" src="/assets/main.js"></script>';

    expect(inlineScriptHashes(html)).toEqual([]);
  });

  it('still hashes an inline script that has a src-suffixed attribute', () => {
    // `\bsrc=` would skip this one, because `-` to `s` is a word boundary — and
    // a skipped script is one the policy blocks in production while the build
    // reports success. The match therefore requires whitespace before `src`.
    const html = '<script data-src="ignored">var a = 1;</script>';

    expect(inlineScriptHashes(html)).toEqual([hashInlineScript('var a = 1;')]);
  });

  it('ignores an empty script rather than emitting a hash for nothing', () => {
    expect(inlineScriptHashes('<script>\n  \n</script>')).toEqual([]);
  });

  it('hashes the body exactly, including whitespace', () => {
    // The digest covers the bytes between the tags verbatim. Trimming here
    // would produce a hash the browser never computes, and the script would be
    // blocked with the policy looking correct.
    const body = '\n  var a = 1;\n';
    expect(inlineScriptHashes(`<script>${body}</script>`)).toEqual([hashInlineScript(body)]);
  });

  it('finds every inline script, not just the first', () => {
    const html = '<script>var a = 1;</script><script>var b = 2;</script>';

    expect(inlineScriptHashes(html)).toEqual([
      hashInlineScript('var a = 1;'),
      hashInlineScript('var b = 2;'),
    ]);
  });
});
