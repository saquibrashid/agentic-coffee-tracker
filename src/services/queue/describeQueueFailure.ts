import { ApiError, ApiTimeoutError } from '@/services/ai';

/**
 * Turns a failure into the sentence shown beside a stuck operation.
 *
 * The queue used to store `error.message` directly, which for an API failure is
 * `POST /api/parse -> 500` — a string that tells the user nothing except that
 * something is broken, and reads like their fault. The commonest cause is not a
 * fault at all: the model is throttled, and waiting is the whole fix.
 *
 * Every message here ends by saying the app will keep trying, because it will —
 * `handleFailure` has no attempt cap, only backoff. Saying so is what turns a
 * red line into information rather than an alarm.
 *
 * Anything unrecognised keeps its original message. A wrong-but-friendly
 * sentence over an unknown failure would cost the one clue worth having.
 */
export function describeQueueFailure(err: unknown): string {
  if (err instanceof ApiTimeoutError) {
    return 'That took too long to answer. Still trying.';
  }
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return 'The AI service is busy right now. Still trying.';
    }
    if (err.status === 503) {
      return 'The AI service is unavailable right now. Still trying.';
    }
    if (err.status >= 500) {
      return 'Something went wrong on our side. Still trying.';
    }
  }
  return err instanceof Error ? err.message : String(err);
}
