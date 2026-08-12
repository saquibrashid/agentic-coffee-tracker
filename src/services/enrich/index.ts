import { parse, scrape, search, type ParsedBean, type SearchResult } from '@/services/ai';
import { extractBeanFromPhoto } from '@/services/ai/pipeline';
import { extractPdfText, pdfHasText, renderPdfFirstPage } from '@/services/pdf/extractPdfText';

/**
 * Orchestrates the web-enrichment chain: search for the product page, scrape
 * its text, then run that text through the same `/api/parse` contract the photo
 * pipeline uses. Reusing `parse` matters — it means a scraped page and a bag
 * photo produce the same shape, validated against the same schema, so the
 * confirm/diff UI downstream does not need to care which one it came from.
 */

export type EnrichCandidate = SearchResult;

export async function findCandidates(
  roaster: string,
  name: string,
  max = 5,
): Promise<EnrichCandidate[]> {
  const response = await search({ roaster, name, max });
  return response.results;
}

export interface EnrichedPage {
  parsed: ParsedBean;
  rawText: string;
  /**
   * Absent when the details did not come from a page — pasted text and PDFs
   * have no address, and the coffees that need them are exactly the ones with
   * no page to point at.
   */
  sourceUrl?: string;
  model: string;
  /** The product image on the page, when the scrape found one. */
  imageUrl?: string;
}

function extractRawText(extracted: Record<string, unknown>): string {
  const rawText = extracted['rawText'];
  return typeof rawText === 'string' ? rawText : '';
}

export class EmptyPageError extends Error {
  constructor(readonly url: string) {
    super('That page had no readable text.');
    this.name = 'EmptyPageError';
  }
}

/** Below this, there is not enough to parse and asking the model just wastes a call. */
const MIN_USEFUL_TEXT = 20;

export class EmptyTextError extends Error {
  constructor() {
    super('There was not enough text there to work with.');
    this.name = 'EmptyTextError';
  }
}

/** The words were read, but nothing about a coffee could be made of them. */
export class UnreadableDetailsError extends Error {
  constructor() {
    super('We could not pick out any coffee details from that.');
    this.name = 'UnreadableDetailsError';
  }
}

/**
 * Turns text the user supplied into the same shape a scraped page produces.
 *
 * Some coffees have no page at all — a bag from a roaster with no storefront, a
 * subscription insert, a printed card. The details still exist, just not
 * anywhere fetchable, and the parsing step never needed a URL: it only ever
 * wanted text. So this hands the user's text to the identical `/api/parse`
 * contract, which means the review-and-choose UI treats it exactly like a
 * scraped page and nothing downstream has to learn a second shape.
 */
export async function enrichFromText(text: string): Promise<EnrichedPage> {
  const trimmed = text.trim();
  if (trimmed.length < MIN_USEFUL_TEXT) throw new EmptyTextError();

  const result = await parse({ ocrText: trimmed });
  return { parsed: result.parsed, rawText: result.rawText, model: result.model };
}

/**
 * Reads a PDF and returns it in the same shape as a scraped page.
 *
 * The branch here is the whole point. A PDF written by software has its words
 * in a text layer, so reading it is enough. A PDF that is a scan or a phone
 * photo has no text layer at all and yields an empty string rather than an
 * error — indistinguishable from a blank document unless you check. When that
 * happens the page is rendered to an image and sent through the OCR the camera
 * already uses, which is exactly the tool for a picture of words.
 */
export async function enrichFromPdf(file: Blob): Promise<EnrichedPage> {
  const text = await extractPdfText(file);
  if (pdfHasText(text)) return enrichFromText(text);

  const image = await renderPdfFirstPage(file);
  const result = await extractBeanFromPhoto(image);
  if (!pdfHasText(result.rawText)) throw new EmptyTextError();
  // The photo pipeline reports an unusable parse rather than throwing, because
  // its own caller falls back to a manual form. Here there is nothing to
  // propose, so it has to become a failure the panel can show.
  if (!result.parsed) throw new UnreadableDetailsError();
  return { parsed: result.parsed, rawText: result.rawText, model: result.model ?? 'unknown' };
}

/**
 * A page that really was a page.
 *
 * `enrichFromUrl` always knows where it read from, and callers like
 * `autoEnrichBean` stamp that onto the bean unconditionally. Narrowing the
 * return type keeps that guarantee at the type level instead of leaving them to
 * assume it.
 */
export type EnrichedUrl = EnrichedPage & { sourceUrl: string };

export async function enrichFromUrl(url: string): Promise<EnrichedUrl> {
  const scraped = await scrape({ url });
  const rawText = extractRawText(scraped.extracted);
  // A page that yields no text cannot produce a meaningful parse; failing here
  // gives the user an actionable message instead of an empty diff.
  if (rawText.trim().length === 0) throw new EmptyPageError(url);

  const result = await parse({ ocrText: rawText });
  return {
    parsed: result.parsed,
    rawText: result.rawText,
    sourceUrl: scraped.sourceUrl,
    model: result.model,
    ...(scraped.imageUrl ? { imageUrl: scraped.imageUrl } : {}),
  };
}
