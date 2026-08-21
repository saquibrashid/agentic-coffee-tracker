import { describe, expect, it } from 'vitest';

import {
  collectDiagnostics,
  describeBrowser,
  describeDisplay,
  diagnosticRows,
} from './diagnostics';

describe('describeBrowser', () => {
  it('names the engine and platform rather than reprinting the UA string', () => {
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iOS');
  });

  it('prefers Edge and Chrome over the Safari token they both carry', () => {
    expect(describeBrowser('… Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0')).toBe(
      'Edge on unknown platform',
    );
    expect(describeBrowser('(Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36')).toBe(
      'Chrome on Windows',
    );
  });

  it('says so plainly when it cannot tell', () => {
    expect(describeBrowser('')).toBe('Unknown browser on unknown platform');
  });
});

describe('describeDisplay', () => {
  it('distinguishes an installed app from a tab', () => {
    expect(describeDisplay(true)).toBe('Installed to home screen');
    expect(describeDisplay(false)).toBe('Browser tab');
  });
});

describe('collectDiagnostics', () => {
  // The whole point of the module: this is what gets published, so the shape of
  // it is a contract rather than an implementation detail.
  it('collects exactly six things, none of which identify anybody', () => {
    const diagnostics = collectDiagnostics('/add');
    expect(Object.keys(diagnostics).sort()).toEqual([
      'appVersion',
      'display',
      'route',
      'signedIn',
      'syncState',
      'userAgent',
    ]);
    expect(diagnostics.route).toBe('/add');
    expect(typeof diagnostics.signedIn).toBe('boolean');
  });

  it('previews the same values it sends, so the disclosure cannot lie', () => {
    const diagnostics = collectDiagnostics('/analytics');
    const rows = diagnosticRows(diagnostics);
    expect(rows).toHaveLength(Object.keys(diagnostics).length);
    expect(rows.map(([, value]) => value)).toContain('/analytics');
    expect(rows.find(([label]) => label === 'Signed in')?.[1]).toBe(
      diagnostics.signedIn ? 'yes' : 'no',
    );
  });
});
