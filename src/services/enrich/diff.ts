import type { ParsedBean } from '@/services/ai';
import { parsedBeanToUpdate } from '@/services/ai/mapping';
import type { CoffeeBean } from '@/types';

/**
 * Field-level diffing for web enrichment (specs/ui.md).
 *
 * Enrichment is strictly additive and always opt-in. The user typed or
 * confirmed what is already on the bean; a scraped product page is a
 * suggestion, not an authority. So nothing is written without an explicit
 * per-field choice, and this module exists to make that choice presentable.
 */

/** Fields enrichment is allowed to touch. Deliberately excludes anything the
 * user records about their own purchase — price, bag size, dates — since a
 * product page cannot know those. */
export const ENRICHABLE_FIELDS = [
  'roaster',
  'name',
  'origins',
  'process',
  'roastLevel',
  'varietals',
  'tastingNotes',
  'roasterDescription',
] as const;

export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

export interface FieldProposal {
  field: EnrichableField;
  label: string;
  /** Human-readable current value, or null when the bean has nothing here. */
  current: string | null;
  /** Human-readable proposed value. */
  proposed: string;
  /** True when the bean has a real value that would be replaced. */
  isConflict: boolean;
}

const FIELD_LABELS: Record<EnrichableField, string> = {
  roaster: 'Roaster',
  name: 'Name',
  origins: 'Origins',
  process: 'Process',
  roastLevel: 'Roast level',
  varietals: 'Varietals',
  tastingNotes: 'Tasting notes',
  roasterDescription: 'Roaster description',
};

/**
 * Values the capture flow writes as stand-ins before the AI has run. Treating
 * them as real data would make every enriched bean look like a conflict and
 * train the user to click through the warnings.
 */
const PLACEHOLDERS = new Set(['unknown', 'draft from photo', 'untitled', '']);

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return PLACEHOLDERS.has(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function formatValue(field: EnrichableField, value: unknown): string | null {
  if (isEmptyValue(value)) return null;
  if (field === 'origins' && Array.isArray(value)) {
    return value
      .map((origin) => {
        const o = origin as { country?: string; region?: string };
        return o.region ? `${o.country} (${o.region})` : (o.country ?? '');
      })
      .filter(Boolean)
      .join(', ');
  }
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function sameValue(field: EnrichableField, a: unknown, b: unknown): boolean {
  return formatValue(field, a) === formatValue(field, b);
}

/**
 * Builds the list of changes the user could accept. A field only appears when
 * the enrichment actually has something *different* to offer — proposing a
 * value identical to the current one is noise that hides the real changes.
 */
export function buildProposals(bean: CoffeeBean, parsed: ParsedBean): FieldProposal[] {
  const update = parsedBeanToUpdate(parsed);
  const proposals: FieldProposal[] = [];

  for (const field of ENRICHABLE_FIELDS) {
    const proposedValue = update[field];
    if (isEmptyValue(proposedValue)) continue;

    const currentValue = bean[field];
    if (sameValue(field, currentValue, proposedValue)) continue;

    const proposed = formatValue(field, proposedValue);
    if (proposed === null) continue;

    proposals.push({
      field,
      label: FIELD_LABELS[field],
      current: formatValue(field, currentValue),
      proposed,
      isConflict: !isEmptyValue(currentValue),
    });
  }

  return proposals;
}

/**
 * Fields that were empty are safe to accept by default; fields that would
 * overwrite something the user already has are left unchecked so accepting the
 * defaults can never destroy their data.
 */
export function defaultSelection(proposals: FieldProposal[]): Set<EnrichableField> {
  return new Set(proposals.filter((p) => !p.isConflict).map((p) => p.field));
}

export interface ApplyOptions {
  /**
   * Where the details came from, when that is a place. Details typed or pasted
   * in have no address, and inventing one — or blanking whatever the coffee was
   * previously stamped with — would both be lies about provenance.
   */
  sourceUrl?: string;
  now?: string;
}

/**
 * Produces the Dexie update for the accepted fields only. Anything enrichment
 * touches is flagged `needsReview` and stamped with its source, so a later
 * reader can tell which values a human confirmed and which came off a web page.
 */
export function applyProposals(
  parsed: ParsedBean,
  selected: ReadonlySet<EnrichableField>,
  options: ApplyOptions,
): Partial<CoffeeBean> {
  const update = parsedBeanToUpdate(parsed);
  const result: Partial<CoffeeBean> = {};

  for (const field of ENRICHABLE_FIELDS) {
    if (!selected.has(field)) continue;
    const value = update[field];
    if (isEmptyValue(value)) continue;
    Object.assign(result, { [field]: value });
  }

  if (Object.keys(result).length === 0) return {};

  if (options.sourceUrl) result.sourceUrl = options.sourceUrl;
  result.needsReview = true;
  result.updatedAt = options.now ?? new Date().toISOString();
  return result;
}
