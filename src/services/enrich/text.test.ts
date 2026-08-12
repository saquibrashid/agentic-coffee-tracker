import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Details that arrive as text rather than a page.
 *
 * The coffees that need this are the ones enrichment can never reach — a
 * roaster with no storefront, a subscription insert, a printed card. What
 * matters is that they end up in exactly the same shape a scraped page
 * produces, because the review UI downstream has no idea which one it is
 * looking at and must not have to learn.
 */

const parse = vi.hoisted(() => vi.fn());
const extractBeanFromPhoto = vi.hoisted(() => vi.fn());
const extractPdfText = vi.hoisted(() => vi.fn());
const renderPdfFirstPage = vi.hoisted(() => vi.fn());

vi.mock('@/services/ai', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  parse,
}));

vi.mock('@/services/ai/pipeline', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  extractBeanFromPhoto,
}));

vi.mock('@/services/pdf/extractPdfText', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  extractPdfText,
  renderPdfFirstPage,
}));

const { EmptyTextError, UnreadableDetailsError, enrichFromPdf, enrichFromText } =
  await import('./index');

const parsed = { name: 'Holler Mountain', roastLevel: 'medium', confidence: 0.9 };

const DETAILS =
  'Holler Mountain — Ethiopia and Guatemala, washed, medium roast. Notes of citrus zest and dark chocolate.';

beforeEach(() => {
  vi.clearAllMocks();
  parse.mockResolvedValue({ parsed, rawText: DETAILS, model: 'test-model' });
});

describe('enrichFromText', () => {
  it('parses pasted details into the shape a page produces', async () => {
    const page = await enrichFromText(DETAILS);

    expect(parse).toHaveBeenCalledWith({ ocrText: DETAILS });
    expect(page.parsed).toEqual(parsed);
    expect(page.model).toBe('test-model');
  });

  it('reports no source, rather than inventing one', async () => {
    // A blank sourceUrl would erase the address a coffee was previously
    // enriched from, which is worse than admitting there was none.
    const page = await enrichFromText(DETAILS);
    expect(page.sourceUrl).toBeUndefined();
  });

  it('refuses text too short to be worth a model call', async () => {
    await expect(enrichFromText('   Holler   ')).rejects.toBeInstanceOf(EmptyTextError);
    expect(parse).not.toHaveBeenCalled();
  });
});

describe('enrichFromPdf', () => {
  const file = new Blob(['%PDF-1.7'], { type: 'application/pdf' });

  it('reads the text layer when the PDF has one', async () => {
    extractPdfText.mockResolvedValue(DETAILS);

    const page = await enrichFromPdf(file);

    expect(page.parsed).toEqual(parsed);
    // The expensive path must not run when the cheap one answered.
    expect(renderPdfFirstPage).not.toHaveBeenCalled();
    expect(extractBeanFromPhoto).not.toHaveBeenCalled();
  });

  it('falls back to OCR when the PDF is a scan', async () => {
    // A scanned PDF returns '' rather than failing, so an empty text layer is
    // the only signal that the words are a picture.
    extractPdfText.mockResolvedValue('');
    const image = new Blob(['jpeg'], { type: 'image/jpeg' });
    renderPdfFirstPage.mockResolvedValue(image);
    extractBeanFromPhoto.mockResolvedValue({
      rawText: DETAILS,
      parsed,
      model: 'vision',
      needsReview: false,
      usedMock: false,
    });

    const page = await enrichFromPdf(file);

    expect(renderPdfFirstPage).toHaveBeenCalledWith(file);
    expect(extractBeanFromPhoto).toHaveBeenCalledWith(image);
    expect(page.parsed).toEqual(parsed);
  });

  it('gives up when a scan yields nothing readable', async () => {
    extractPdfText.mockResolvedValue('');
    renderPdfFirstPage.mockResolvedValue(new Blob(['jpeg']));
    extractBeanFromPhoto.mockResolvedValue({
      rawText: '',
      parsed: null,
      model: null,
      needsReview: true,
      usedMock: false,
    });

    await expect(enrichFromPdf(file)).rejects.toBeInstanceOf(EmptyTextError);
  });

  it('reports unusable output rather than proposing nothing', async () => {
    // The photo pipeline returns a null parse instead of throwing, because its
    // own caller offers a manual form. There is no such fallback here.
    extractPdfText.mockResolvedValue('');
    renderPdfFirstPage.mockResolvedValue(new Blob(['jpeg']));
    extractBeanFromPhoto.mockResolvedValue({
      rawText: DETAILS,
      parsed: null,
      model: null,
      needsReview: true,
      usedMock: false,
    });

    await expect(enrichFromPdf(file)).rejects.toBeInstanceOf(UnreadableDetailsError);
  });
});
