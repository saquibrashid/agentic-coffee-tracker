import { describe, expect, it } from 'vitest';
import { ApiError, ApiTimeoutError } from '@/services/ai';
import { describeQueueFailure } from './describeQueueFailure';

describe('describeQueueFailure', () => {
  it('says the service is busy rather than printing a status code', () => {
    expect(describeQueueFailure(new ApiError('POST /api/parse -> 429', 429))).toBe(
      'The AI service is busy right now. Still trying.',
    );
  });

  it('distinguishes an unavailable service from a busy one', () => {
    expect(describeQueueFailure(new ApiError('POST /api/parse -> 503', 503))).toBe(
      'The AI service is unavailable right now. Still trying.',
    );
  });

  it('owns a real server fault instead of blaming the user', () => {
    expect(describeQueueFailure(new ApiError('POST /api/parse -> 500', 500))).toBe(
      'Something went wrong on our side. Still trying.',
    );
  });

  it('explains a timeout in the same voice', () => {
    expect(describeQueueFailure(new ApiTimeoutError('/api/parse', 30_000))).toBe(
      'That took too long to answer. Still trying.',
    );
  });

  it('keeps the original message for a failure it does not recognise', () => {
    // A friendly sentence over an unknown error would throw away the only clue
    // anyone has about what went wrong.
    expect(describeQueueFailure(new Error('network down'))).toBe('network down');
  });

  it('leaves a 4xx alone, because retrying will not fix a bad request', () => {
    expect(describeQueueFailure(new ApiError('POST /api/parse -> 400', 400))).toBe(
      'POST /api/parse -> 400',
    );
  });

  it('survives something that is not an Error at all', () => {
    expect(describeQueueFailure('just a string')).toBe('just a string');
  });
});
