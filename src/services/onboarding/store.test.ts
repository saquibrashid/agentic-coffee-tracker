import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/services/db';
import { dismissHint, markVisited, readOnboarding, resetHints } from './store';

beforeEach(async () => {
  await db.meta.clear();
});

describe('onboarding store', () => {
  it('starts empty rather than undefined, so callers need no fallback', async () => {
    expect(await readOnboarding()).toEqual({ dismissed: [], visited: [] });
  });

  it('remembers a dismissal', async () => {
    await dismissHint('rate-first');
    expect((await readOnboarding()).dismissed).toEqual(['rate-first']);
  });

  it('does not duplicate a repeated dismissal', async () => {
    await dismissHint('rate-first');
    await dismissHint('rate-first');
    expect((await readOnboarding()).dismissed).toEqual(['rate-first']);
  });

  it('keeps dismissals and visits independent', async () => {
    await dismissHint('rate-first');
    await markVisited('/for-you');
    expect(await readOnboarding()).toEqual({
      dismissed: ['rate-first'],
      visited: ['/for-you'],
    });
  });

  it('records each route once', async () => {
    await markVisited('/predict');
    await markVisited('/predict');
    expect((await readOnboarding()).visited).toEqual(['/predict']);
  });

  // "Show hints again" is about the hints, not about pretending the user has
  // never opened a page they demonstrably have.
  it('restores hints without forgetting where the user has been', async () => {
    await dismissHint('try-check');
    await markVisited('/predict');
    await resetHints();
    expect(await readOnboarding()).toEqual({ dismissed: [], visited: ['/predict'] });
  });

  it('survives a corrupted record instead of throwing at startup', async () => {
    await db.meta.put({ key: 'onboarding', value: 'nonsense' });
    expect(await readOnboarding()).toEqual({ dismissed: [], visited: [] });
  });
});
