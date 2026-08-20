import { collectDiagnostics, type FeedbackDiagnostics } from './diagnostics';

/**
 * Submitting feedback.
 *
 * Separate from the AI client in `services/ai` on purpose: that module's
 * `apiPost` throws `ApiError` for everything non-2xx, and this endpoint's
 * interesting failures are ones the user must be told apart — "not set up on
 * this deployment" needs a link to GitHub, "too many at once" needs a wait, and
 * a genuine break needs an apology. Collapsing them into one thrown error would
 * lose exactly the distinction the person needs.
 */

export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'question', 'confusion'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'Something is broken',
  idea: 'An idea',
  question: 'A question',
  confusion: 'Something confused me',
};

export const MAX_MESSAGE_LENGTH = 4000;

export type FeedbackResult =
  | { kind: 'filed'; url: string; number: number }
  | { kind: 'unconfigured'; fallbackUrl: string }
  | { kind: 'rate-limited' }
  | { kind: 'failed'; message: string };

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const TIMEOUT_MS = 20_000;

export async function sendFeedback(input: {
  message: string;
  category: FeedbackCategory | undefined;
  diagnostics: FeedbackDiagnostics;
}): Promise<FeedbackResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: input.message,
        ...(input.category ? { category: input.category } : {}),
        diagnostics: input.diagnostics,
      }),
      signal: controller.signal,
    });

    if (res.status === 429) return { kind: 'rate-limited' };

    const payload = (await res.json().catch(() => ({}))) as {
      html_url?: string;
      url?: string;
      number?: number;
      error?: string;
      fallbackUrl?: string;
    };

    if (res.status === 503 && typeof payload.fallbackUrl === 'string') {
      return { kind: 'unconfigured', fallbackUrl: payload.fallbackUrl };
    }

    if (!res.ok || typeof payload.url !== 'string' || typeof payload.number !== 'number') {
      return { kind: 'failed', message: payload.error ?? 'That did not go through.' };
    }

    return { kind: 'filed', url: payload.url, number: payload.number };
  } catch {
    return {
      kind: 'failed',
      message: 'That did not go through — check your connection and try again.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export { collectDiagnostics };
export type { FeedbackDiagnostics };
