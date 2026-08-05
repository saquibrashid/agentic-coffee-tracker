import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './index';
import type * as AiModule from './index';

const ocr = vi.fn();
const parse = vi.fn();

vi.mock('./index', async () => {
  const actual = await vi.importActual<typeof AiModule>('./index');
  return { ...actual, ocr: (...a: unknown[]) => ocr(...a), parse: (...a: unknown[]) => parse(...a) };
});

const { extractBeanFromPhoto, PipelineUnavailableError } = await import('./pipeline');

const parsed = {
  roaster: 'Onyx',
  name: 'Geometry',
  origins: [],
  process: null,
  roastLevel: null,
  tastingNotes: [],
  roastDate: null,
  varietals: [],
  elevationMeters: null,
  roasterDescription: null,
  confidence: 0.9,
};

const blob = new Blob(['fake-image'], { type: 'image/webp' });

describe('extractBeanFromPhoto', () => {
  beforeEach(() => {
    ocr.mockReset();
    parse.mockReset();
  });

  it('returns the parsed bean on the happy path', async () => {
    ocr.mockResolvedValue({ rawText: 'ONYX GEOMETRY', provider: 'azure-vision' });
    parse.mockResolvedValue({ parsed, model: 'gpt-4o', rawText: 'ONYX GEOMETRY' });

    const result = await extractBeanFromPhoto(blob);

    expect(result.parsed).toEqual(parsed);
    expect(result.rawText).toBe('ONYX GEOMETRY');
    expect(result.needsReview).toBe(false);
    expect(result.usedMock).toBe(false);
  });

  it('flags a server-side mock OCR provider as synthetic', async () => {
    ocr.mockResolvedValue({ rawText: 'Mock OCR: Bag label', provider: 'mock-vision' });
    parse.mockResolvedValue({ parsed, model: 'gpt-4o', rawText: 'Mock OCR: Bag label' });

    await expect(extractBeanFromPhoto(blob)).resolves.toMatchObject({ usedMock: true });
  });

  it('flags a server-side mock parse model as synthetic', async () => {
    ocr.mockResolvedValue({ rawText: 'ONYX GEOMETRY', provider: 'azure-vision' });
    parse.mockResolvedValue({ parsed, model: 'mock-model', rawText: 'ONYX GEOMETRY' });

    await expect(extractBeanFromPhoto(blob)).resolves.toMatchObject({ usedMock: true });
  });

  it('flags low-confidence results for review', async () => {    ocr.mockResolvedValue({ rawText: 'blurry', provider: 'azure-vision' });
    parse.mockResolvedValue({ parsed: { ...parsed, confidence: 0.2 }, model: 'gpt-4o', rawText: 'blurry' });

    await expect(extractBeanFromPhoto(blob)).resolves.toMatchObject({ needsReview: true });
  });

  it('treats a 422 schema error as manual-entry, not a failure', async () => {
    ocr.mockResolvedValue({ rawText: 'ONYX', provider: 'azure-vision' });
    parse.mockRejectedValue(
      new ApiError('POST /api/parse -> 422', 422, {
        error: 'bad',
        details: ['/confidence must be a number'],
        model: 'gpt-4o',
        rawText: 'ONYX',
      }),
    );

    const result = await extractBeanFromPhoto(blob);

    expect(result.parsed).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.schemaErrors).toEqual(['/confidence must be a number']);
    expect(result.rawText).toBe('ONYX');
  });

  it('rethrows client errors so our own bugs surface loudly', async () => {
    ocr.mockResolvedValue({ rawText: 'ONYX', provider: 'azure-vision' });
    parse.mockRejectedValue(new ApiError('POST /api/parse -> 400', 400));

    await expect(extractBeanFromPhoto(blob)).rejects.toBeInstanceOf(ApiError);
  });

  it('treats a 5xx as retryable, falling back rather than throwing', async () => {
    ocr.mockResolvedValue({ rawText: 'ONYX', provider: 'azure-vision' });
    parse.mockRejectedValue(new ApiError('POST /api/parse -> 502', 502));

    await expect(extractBeanFromPhoto(blob)).resolves.toMatchObject({
      parsed: null,
      needsReview: true,
    });
  });

  it('falls back to mocks when the BFF is unreachable in dev', async () => {
    // import.meta.env.DEV is true under Vitest, so mock fallback is enabled.
    ocr.mockRejectedValue(new TypeError('Failed to fetch'));
    parse.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await extractBeanFromPhoto(blob);

    expect(result.usedMock).toBe(true);
    expect(result.needsReview).toBe(true);
    expect(result.rawText).toContain('Mock roaster');
  });

  it('exports a distinct error type for unreachable-backend handling', () => {
    expect(new PipelineUnavailableError().name).toBe('PipelineUnavailableError');
  });
});
