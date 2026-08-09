import { describe, expect, it } from 'vitest';

import { getAuthProvider, LocalOnlyAuthProvider, resetAuthProviderForTests } from './index';

describe('LocalOnlyAuthProvider', () => {
  const auth = new LocalOnlyAuthProvider();

  it('reports nobody signed in', async () => {
    await expect(auth.getUser()).resolves.toBeNull();
  });

  it('advertises that it cannot sign anyone in', () => {
    // The UI branches on this to omit sign-in entirely, rather than offering a
    // button that cannot work.
    expect(auth.isAvailable).toBe(false);
  });

  it('rejects a sign-in attempt instead of hanging', async () => {
    // A silent no-op would leave the caller waiting for a sign-in that is never
    // coming, with no way to tell "in progress" from "impossible".
    await expect(auth.login('aad')).rejects.toThrow(/not available/i);
  });

  it('treats signing out of nothing as success', async () => {
    await expect(auth.logout()).resolves.toBeUndefined();
    await expect(auth.logout()).resolves.toBeUndefined();
  });
});

describe('getAuthProvider', () => {
  it('returns the same instance every time', () => {
    resetAuthProviderForTests();
    expect(getAuthProvider()).toBe(getAuthProvider());
  });

  it('is local-only in this build', () => {
    resetAuthProviderForTests();
    expect(getAuthProvider()).toBeInstanceOf(LocalOnlyAuthProvider);
  });
});
