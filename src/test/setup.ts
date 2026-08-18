import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Per-test teardown.
 *
 * `cleanup` unmounts anything still rendered. The storage wipe is the less
 * obvious half: `localStorage` is a single jsdom object shared by every test in
 * a file, and vitest reuses the environment across files in a worker, so a
 * value written by one test is visible to every test that runs after it.
 *
 * That is not hypothetical. `AppearancePanel.test.tsx` drives the real theme
 * control, which persists `coffee-app.theme`; `theme.test.ts` then read it back
 * and failed — but only when the ordering happened to put them that way round.
 * A test that passes or fails depending on what ran before it is worse than a
 * failing one, because the failure lands on whichever change was unlucky rather
 * than on the change that caused it.
 *
 * Wiping here rather than in the offending file is deliberate: the next test to
 * persist something would otherwise reintroduce the same class of bug, and
 * nobody would connect the two.
 */
afterEach(() => {
  cleanup();

  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // A test may have replaced storage with a stand-in that throws. Teardown is
    // not the place to fail over it.
  }
});
