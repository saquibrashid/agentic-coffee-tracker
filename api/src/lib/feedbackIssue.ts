/**
 * Turning a person's message into an issue body, without turning them into one.
 *
 * This module is deliberately pure and deliberately paranoid. The repository is
 * public, so everything that comes out of here is world-readable the moment the
 * endpoint files it — which makes the allowlist below the actual privacy
 * control, not a formality (#196). A denylist would have been the natural way
 * to write it and the wrong one: it fails open, so the first time the client
 * starts sending a new diagnostic field, that field is published.
 */

export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'question', 'confusion'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** Long enough for a considered paragraph, short enough not to be a payload. */
export const MAX_MESSAGE_LENGTH = 4000;
/** Every diagnostic is a short label; anything longer is not one. */
const MAX_FIELD_LENGTH = 200;
const MAX_TITLE_LENGTH = 72;

export interface FeedbackDiagnostics {
  route?: string;
  appVersion?: string;
  userAgent?: string;
  display?: string;
  signedIn?: boolean;
  syncState?: string;
}

export interface FeedbackSubmission {
  message: string;
  category?: FeedbackCategory;
  diagnostics?: FeedbackDiagnostics;
}

export interface ValidationFailure {
  ok: false;
  error: string;
}
export interface ValidationSuccess {
  ok: true;
  value: { message: string; category: FeedbackCategory | undefined; diagnostics: string[][] };
}

function clamp(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, limit);
}

/**
 * The allowlist, as ordered rows.
 *
 * Nothing here identifies anybody: "Signed in: yes" is the part that explains a
 * sync bug, and *who* never is. The issue that prompted this would have been
 * answered by exactly these six lines.
 */
function diagnosticRows(input: FeedbackDiagnostics | undefined): string[][] {
  if (!input || typeof input !== 'object') return [];
  const rows: string[][] = [];
  const push = (label: string, value: string | undefined) => {
    if (value !== undefined) rows.push([label, value]);
  };

  push('App version', clamp(input.appVersion, MAX_FIELD_LENGTH));
  push('Screen', clamp(input.route, MAX_FIELD_LENGTH));
  push('Display', clamp(input.display, MAX_FIELD_LENGTH));
  push('Browser', clamp(input.userAgent, MAX_FIELD_LENGTH));
  if (typeof input.signedIn === 'boolean') push('Signed in', input.signedIn ? 'yes' : 'no');
  push('Sync', clamp(input.syncState, MAX_FIELD_LENGTH));

  return rows;
}

export function validateFeedback(body: unknown): ValidationFailure | ValidationSuccess {
  if (typeof body !== 'object' || body === null)
    return { ok: false, error: 'A message is required' };
  const input = body as Partial<FeedbackSubmission>;

  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (message === '') return { ok: false, error: 'A message is required' };
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Feedback is limited to ${MAX_MESSAGE_LENGTH} characters` };
  }

  // An unrecognised category is dropped rather than rejected. It only chooses a
  // label; refusing the whole submission over it would lose someone's words to
  // a detail they never saw.
  const category = FEEDBACK_CATEGORIES.includes(input.category as FeedbackCategory)
    ? (input.category as FeedbackCategory)
    : undefined;

  return { ok: true, value: { message, category, diagnostics: diagnosticRows(input.diagnostics) } };
}

/**
 * A title drawn from the first sentence, not from a model.
 *
 * The model was tempting — feedback arrives as prose and issues want a
 * sentence — but a titling call is a second way for a submission to fail, adds
 * seconds to a button the user is waiting on, and can put words in someone's
 * mouth on a public issue. The first sentence is what they actually wrote, and
 * a human reads the body underneath it regardless.
 */
export function issueTitle(message: string, category: FeedbackCategory | undefined): string {
  const firstSentence = message.split(/(?<=[.!?])\s|\n/)[0]?.trim() ?? message;
  const source = firstSentence === '' ? message : firstSentence;
  const clipped =
    source.length > MAX_TITLE_LENGTH
      ? `${source.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
      : source;
  return category ? `[${category}] ${clipped}` : `[feedback] ${clipped}`;
}

/**
 * The issue body.
 *
 * The user's words come first and unedited. The diagnostics follow in a table
 * because they are context for whoever triages it, not the report itself — and
 * the closing line records that a human pressed a button, which is the claim
 * `SECURITY.md` now makes about this endpoint.
 */
export function issueBody(value: ValidationSuccess['value']): string {
  const parts = [value.message];

  if (value.diagnostics.length > 0) {
    parts.push(
      ['| | |', '| --- | --- |', ...value.diagnostics.map(([k, v]) => `| ${k} | ${v} |`)].join(
        '\n',
      ),
    );
  }

  parts.push(
    '_Sent from inside the app by someone who chose to send it. No identity, and no coffee data, is attached._',
  );
  return parts.join('\n\n');
}

export const FEEDBACK_LABELS = ['feedback', 'needs-triage'];
