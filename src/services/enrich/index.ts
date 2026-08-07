import { parse, scrape, search, type ParsedBean, type SearchResult } from '@/services/ai';

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
  sourceUrl: string;
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

export async function enrichFromUrl(url: string): Promise<EnrichedPage> {
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
