import { describe, expect, it } from 'vitest';

import {
  FEEDBACK_LABELS,
  MAX_MESSAGE_LENGTH,
  issueBody,
  issueTitle,
  validateFeedback,
  type ValidationSuccess,
} from './feedbackIssue.js';

function ok(body: unknown): ValidationSuccess['value'] {
  const result = validateFeedback(body);
  if (!result.ok) throw new Error(`expected valid, got: ${result.error}`);
  return result.value;
}

describe('validateFeedback', () => {
  it('refuses an empty message rather than filing a blank issue', () => {
    expect(validateFeedback({ message: '   ' })).toMatchObject({ ok: false });
    expect(validateFeedback({})).toMatchObject({ ok: false });
    expect(validateFeedback(null)).toMatchObject({ ok: false });
  });

  it('caps the message instead of accepting a payload', () => {
    const result = validateFeedback({ message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) });
    expect(result.ok).toBe(false);
  });

  it('keeps a message exactly at the limit', () => {
    expect(validateFeedback({ message: 'x'.repeat(MAX_MESSAGE_LENGTH) }).ok).toBe(true);
  });

  it('drops an unknown category rather than losing the message over it', () => {
    expect(ok({ message: 'hello', category: 'urgent' }).category).toBeUndefined();
    expect(ok({ message: 'hello', category: 'bug' }).category).toBe('bug');
  });

  // The allowlist is the privacy control, so this is the test that matters.
  it('publishes only the diagnostics it names', () => {
    const value = ok({
      message: 'the parse dropped my description',
      diagnostics: {
        route: '/add',
        appVersion: '0.1.0',
        userAgent: 'Safari on iOS',
        display: 'standalone',
        signedIn: true,
        syncState: 'idle',
        userId: 'c0ffee-user-id',
        email: 'someone@example.com',
        beans: ['Yirgacheffe'],
      },
    });

    const flat = JSON.stringify(value.diagnostics);
    expect(flat).not.toContain('c0ffee-user-id');
    expect(flat).not.toContain('someone@example.com');
    expect(flat).not.toContain('Yirgacheffe');
    expect(value.diagnostics.map(([label]) => label)).toEqual([
      'App version',
      'Screen',
      'Display',
      'Browser',
      'Signed in',
      'Sync',
    ]);
  });

  it('reports whether someone is signed in, never who', () => {
    expect(ok({ message: 'm', diagnostics: { signedIn: false } }).diagnostics).toEqual([
      ['Signed in', 'no'],
    ]);
  });

  it('omits diagnostics the client did not send instead of writing “unknown”', () => {
    expect(ok({ message: 'm', diagnostics: { route: '/analytics' } }).diagnostics).toEqual([
      ['Screen', '/analytics'],
    ]);
    expect(ok({ message: 'm' }).diagnostics).toEqual([]);
  });

  it('truncates an over-long diagnostic instead of refusing the feedback', () => {
    const [row] = ok({ message: 'm', diagnostics: { userAgent: 'u'.repeat(5000) } }).diagnostics;
    expect(row?.[1]?.length).toBe(200);
  });
});

describe('issueTitle', () => {
  it('uses the first sentence, which is what the person actually wrote', () => {
    expect(issueTitle('I got signed out again. It happened twice today.', 'bug')).toBe(
      '[bug] I got signed out again.',
    );
  });

  it('labels an uncategorised report rather than leaving it bare', () => {
    expect(issueTitle('Something odd happened', undefined)).toBe(
      '[feedback] Something odd happened',
    );
  });

  it('clips a rambling first sentence', () => {
    const title = issueTitle(`${'word '.repeat(50)}.`, 'idea');
    expect(title.length).toBeLessThanOrEqual('[idea] '.length + 72);
    expect(title.endsWith('…')).toBe(true);
  });

  it('survives a message with no sentence-ending punctuation', () => {
    expect(issueTitle('no full stop here', 'question')).toBe('[question] no full stop here');
  });
});

describe('issueBody', () => {
  it('leads with the person’s own words, unedited', () => {
    const body = issueBody(ok({ message: 'the parse dropped my description' }));
    expect(body.startsWith('the parse dropped my description')).toBe(true);
  });

  it('renders diagnostics as a table beneath the report', () => {
    const body = issueBody(ok({ message: 'm', diagnostics: { route: '/add', signedIn: true } }));
    expect(body).toContain('| Screen | /add |');
    expect(body).toContain('| Signed in | yes |');
  });

  it('records that a human chose to send it', () => {
    expect(issueBody(ok({ message: 'm' }))).toContain('chose to send it');
  });
});

describe('FEEDBACK_LABELS', () => {
  it('lands in the backlog already triaged as untriaged', () => {
    expect(FEEDBACK_LABELS).toEqual(['feedback', 'needs-triage']);
  });
});
