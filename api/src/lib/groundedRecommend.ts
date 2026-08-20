/**
 * Recommends *real* coffees, by never letting the model name one.
 *
 * The plain `/api/recommend` path is deliberately generic — it tells the model
 * it has no catalog and forbids it from inventing a roaster or product, so the
 * best it can offer is "another Ethiopia natural". Safe, and not very useful:
 * you cannot click it, buy it, or check whether it exists (issue #179).
 *
 * ## How a real product gets here
 *
 * Two calls, and the split is the whole point.
 *
 * 1. **Find.** A `web_search` call turns the taste summary into real product
 *    pages. Only the `url_citation` annotations are read — pages the search
 *    index actually returned — exactly as `webSearch.ts` does for lookups. The
 *    prose is discarded.
 * 2. **Rank.** The candidates are handed back numbered, and the model answers
 *    with a **candidate index**, not a URL. It has no field in which to write
 *    an address, so it cannot invent one: an index either points at a page the
 *    search returned or it is out of range and the pick is dropped.
 *
 * That is a stronger guarantee than validating a returned URL against a set,
 * because it removes the opportunity rather than catching the mistake.
 *
 * The model still writes the roaster and coffee name for display, and those
 * *could* drift from the page it picked, so `describesCandidate` checks both
 * against the citation's own title and host before the pick is accepted.
 *
 * ## What this does not claim
 *
 * Nothing here knows whether a coffee is in stock. A citation proves a page was
 * listed at the moment we looked, which is why every product carries the time
 * it was verified and the UI sends people to the roaster to check. Saying
 * "available now" would be inventing a fact the search never established.
 */

import {
  callResponses,
  parseJsonOutput,
  type OpenAiConfig,
  type ResponsesTool,
  type UrlCitation,
} from './openai.js';
import { tokenise } from './productSearch.js';
import { isPlausibleProductPage } from './webSearch.js';
import type { PreferenceSummary, Recommendation, RankedSummaryItem } from './recommendSchema.js';

/** A real product page the search returned, ready to be offered to the ranker. */
export interface Candidate {
  url: string;
  title: string;
  host: string;
}

export interface GroundedLogger {
  log: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
}

const CANDIDATE_SEARCH_TOOL: ResponsesTool = {
  type: 'web_search',
  search_context_size: 'medium',
};

/**
 * The search is asked for shopping pages, not for an opinion.
 *
 * It is told to spread across roasters because a single store's catalog will
 * happily fill every slot, and three coffees from one roaster is a narrower
 * answer than the user asked for. Ranking cannot fix that later — it can only
 * choose from what the search brought back.
 */
const FIND_SYSTEM_PROMPT = [
  'You find specific coffees currently listed for sale on coffee roasters\u2019 own online stores.',
  'Search the web and cite product pages for individual coffees that match the described taste.',
  'Cite at least eight different coffees, from as many different roasters as you can.',
  'Never cite a category page, a blog post, a subscription, a sampler, or equipment.',
  'Prefer roasters\u2019 own stores over marketplaces, retailers and review sites.',
].join(' ');

/**
 * The ranker is told it is choosing, not suggesting.
 *
 * "Return fewer" is repeated here for the same reason the generic prompt says
 * it: a model asked for three picks from a weak candidate list will pad, and a
 * padded pick is a real product page attached to a rationale that does not hold.
 */
const RANK_SYSTEM_PROMPT = [
  'You choose which of the supplied coffees a person is most likely to enjoy.',
  'You may only choose from the numbered candidates. Identify each pick by its number.',
  'Copy the roaster and coffee name from the candidate you chose \u2014 do not reword them.',
  'Ground every pick in the taste summary and cite those values in "basedOn".',
  'Aim for a spread: a close match, a related direction, and one that stretches the profile.',
  'Prefer picks from different roasters.',
  'If fewer candidates than requested genuinely fit, return fewer rather than padding.',
  'Any numeric scores are on a 1-10 scale, where 10 is best.',
].join(' ');

export const GROUNDED_PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['picks'],
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'candidate',
          'roaster',
          'coffeeName',
          'rationale',
          'basedOn',
          'origin',
          'roastLevel',
          'process',
          'flavorNotes',
        ],
        properties: {
          // An index, not a URL. The model has nowhere to write an address.
          candidate: { type: 'integer' },
          roaster: { type: 'string' },
          coffeeName: { type: 'string' },
          rationale: { type: 'string' },
          basedOn: { type: 'array', items: { type: 'string' } },
          origin: { type: ['string', 'null'] },
          roastLevel: { type: ['string', 'null'] },
          process: { type: ['string', 'null'] },
          flavorNotes: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

function top(items: RankedSummaryItem[] | undefined, count: number): string[] {
  return (items ?? []).slice(0, count).map((item) => item.value);
}

/**
 * Turns the summary into something a search engine can act on.
 *
 * Roasters are pointedly excluded. The summary's favourite roaster is the one
 * the user already buys from, and seeding the search with it returns their own
 * shelf back to them. Origins, processes and flavours describe the coffee they
 * would enjoy from anyone.
 */
export function describeTaste(summary: PreferenceSummary): string {
  const parts: string[] = [];
  const origins = top(summary.favoriteOrigins, 2);
  const flavors = top(summary.favoriteFlavors, 3);
  const processes = top(summary.favoriteProcesses, 2);
  const roasts = top(summary.favoriteRoastLevels, 1);

  if (origins.length > 0) parts.push(`origins: ${origins.join(', ')}`);
  if (processes.length > 0) parts.push(`processes: ${processes.join(', ')}`);
  if (roasts.length > 0) parts.push(`roast level: ${roasts.join(', ')}`);
  if (flavors.length > 0) parts.push(`flavour notes: ${flavors.join(', ')}`);

  return parts.length > 0 ? parts.join('; ') : 'well-regarded specialty coffee';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Same page, different tracking parameters, is the same coffee twice. */
function canonical(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

/**
 * Narrows the cited pages down to a usable candidate list.
 *
 * The per-host cap is the part that matters. A search for "washed Ethiopia,
 * citrus" reliably returns one roaster's entire Ethiopia range, and without a
 * cap the ranker's only honest choice is three coffees from that one store —
 * which reads as an advert rather than a recommendation, and hides every other
 * roaster the search also found.
 */
export function dedupeCandidates(
  citations: readonly UrlCitation[],
  { perHost = 2, max = 12 }: { perHost?: number; max?: number } = {},
): Candidate[] {
  const seen = new Set<string>();
  const perHostCount = new Map<string, number>();
  const kept: Candidate[] = [];

  for (const citation of citations) {
    if (kept.length >= max) break;
    if (citation.title.trim().length === 0) continue;
    if (!isPlausibleProductPage(citation.url)) continue;

    const key = canonical(citation.url);
    if (seen.has(key)) continue;

    const host = hostOf(citation.url);
    if (host === '') continue;
    const used = perHostCount.get(host) ?? 0;
    if (used >= perHost) continue;

    seen.add(key);
    perHostCount.set(host, used + 1);
    kept.push({ url: citation.url, title: citation.title.trim(), host });
  }

  return kept;
}

/**
 * How much of `needle` is accounted for by the candidate's own words.
 *
 * The host counts as evidence alongside the title because a roaster's name
 * often appears in only one of the two: Anchorhead's product titles do not
 * repeat "Anchorhead", but `anchorheadcoffee.com` does. Matching against the
 * squashed host as a substring is what lets "Anchorhead" find it there, since
 * the domain has no word boundaries to tokenise on.
 */
function coverage(needle: string, candidate: Candidate): number {
  const wanted = tokenise(needle);
  if (wanted.length === 0) return 0;

  const titleTokens = new Set(tokenise(candidate.title));
  const squashed = `${candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, '')}${candidate.host.replace(/[^a-z0-9]+/g, '')}`;

  let matched = 0;
  for (const token of wanted) {
    if (titleTokens.has(token) || squashed.includes(token)) matched += 1;
  }
  return matched / wanted.length;
}

/**
 * Whether the names the model wrote actually describe the page it chose.
 *
 * The index guarantees the *URL* is real; this guarantees the label on it is.
 * Without it the model could pick candidate 3 and caption it with candidate
 * 7's coffee, and the card would send someone to a page for a coffee they were
 * never shown — a more convincing error than an outright invention.
 *
 * The coffee name is held to a higher bar than the roaster because it is the
 * claim being made; a roaster whose name is abbreviated in both title and
 * domain should not cost the user a real match.
 */
export function describesCandidate(
  roaster: string,
  coffeeName: string,
  candidate: Candidate,
): boolean {
  if (coffeeName.trim() === '' || roaster.trim() === '') return false;
  return coverage(coffeeName, candidate) >= 0.6 && coverage(roaster, candidate) >= 0.5;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Turns the model's picks into recommendations, dropping anything unproven.
 *
 * Dropping rather than failing is deliberate: one bad pick out of three should
 * cost the user that pick, not the whole set. An empty result is handled by the
 * caller, which falls back to the generic path.
 */
export function assembleGrounded(
  parsed: unknown,
  candidates: readonly Candidate[],
  verifiedAt: string,
  ctx?: GroundedLogger,
): Recommendation[] {
  if (!isPlainObject(parsed)) return [];
  const picks = parsed['picks'];
  if (!Array.isArray(picks)) return [];

  const usedCandidates = new Set<number>();
  const out: Recommendation[] = [];

  for (const pick of picks) {
    if (!isPlainObject(pick)) continue;

    const index = pick['candidate'];
    if (typeof index !== 'number' || !Number.isInteger(index)) continue;
    // The list is presented to the model as 1-based, so it reads naturally.
    const position = index - 1;
    const candidate = candidates[position];
    if (candidate === undefined) {
      ctx?.warn('grounded pick referenced a candidate that was not offered', { index });
      continue;
    }
    if (usedCandidates.has(position)) continue;

    const roaster = typeof pick['roaster'] === 'string' ? pick['roaster'].trim() : '';
    const coffeeName = typeof pick['coffeeName'] === 'string' ? pick['coffeeName'].trim() : '';
    if (!describesCandidate(roaster, coffeeName, candidate)) {
      ctx?.warn('grounded pick did not describe the page it cited', { index, roaster, coffeeName });
      continue;
    }

    const rationale = typeof pick['rationale'] === 'string' ? pick['rationale'].trim() : '';
    const basedOn = stringArray(pick['basedOn']);
    // Same rule the generic path enforces: an ungrounded suggestion is the
    // failure this endpoint exists to avoid, product page or not.
    if (rationale === '' || basedOn.length === 0) continue;

    usedCandidates.add(position);
    out.push({
      title: coffeeName,
      rationale,
      basedOn,
      origin: nullableString(pick['origin']),
      roastLevel: nullableString(pick['roastLevel']),
      process: nullableString(pick['process']),
      flavorNotes: stringArray(pick['flavorNotes']),
      product: { roaster, name: coffeeName, url: candidate.url, verifiedAt },
    });
  }

  return out;
}

/** How the candidates are shown to the ranker: numbered from 1, title and store. */
export function formatCandidates(candidates: readonly Candidate[]): string {
  return candidates
    .map((candidate, i) => `${i + 1}. ${candidate.title} — sold at ${candidate.host}`)
    .join('\n');
}

/**
 * Whether grounded recommendations may run.
 *
 * Separate from `WEB_SEARCH_ENABLED` because the costs are not comparable: a
 * lookup searches for one coffee the user already owns, while this searches
 * speculatively and then pays for a second ranking call. Being able to switch
 * off the expensive path without also disabling enrichment matters when a bill
 * arrives.
 */
export function isGroundedRecommendEnabled(): boolean {
  const setting = process.env['GROUNDED_RECOMMEND_ENABLED'];
  return setting !== 'false' && setting !== '0';
}

/**
 * Returns real, cited coffees for the summary, or `null` to use the generic path.
 *
 * Never throws. Every failure here — search down, nothing found, nothing that
 * survived validation — is a reason to fall back to generic guidance, not to
 * fail the request. The user asked for suggestions, and "another washed
 * Ethiopia" is worth more to them than an error.
 */
export async function groundedRecommendations(
  config: OpenAiConfig,
  summary: PreferenceSummary,
  max: number,
  ctx: GroundedLogger,
): Promise<{ recommendations: Recommendation[]; model: string } | null> {
  let candidates: Candidate[];
  try {
    const found = await callResponses(config, {
      system: FIND_SYSTEM_PROMPT,
      user: `Find coffees for sale matching this taste profile.\n\n${describeTaste(summary)}`,
      tools: [CANDIDATE_SEARCH_TOOL],
      // Without this the model answers from memory, which is precisely the
      // invented-product failure the citations exist to rule out.
      toolChoice: 'required',
      timeoutMs: 60_000,
    });
    candidates = dedupeCandidates(found.citations);
  } catch (err) {
    ctx.warn('grounded candidate search failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (candidates.length === 0) {
    ctx.log('grounded search returned no usable product pages');
    return null;
  }

  const verifiedAt = new Date().toISOString();

  try {
    const ranked = await callResponses(config, {
      system: RANK_SYSTEM_PROMPT,
      user: [
        `Taste summary:\n${JSON.stringify(summary)}`,
        `Candidates:\n${formatCandidates(candidates)}`,
        `Choose at most ${max}.`,
      ].join('\n\n'),
      format: {
        type: 'json_schema',
        name: 'grounded_picks',
        strict: true,
        schema: GROUNDED_PICK_SCHEMA,
      },
      temperature: 0.3,
    });

    const recommendations = assembleGrounded(
      parseJsonOutput(ranked.text),
      candidates,
      verifiedAt,
      ctx,
    ).slice(0, max);

    if (recommendations.length === 0) {
      ctx.log('no grounded pick survived validation', { candidates: candidates.length });
      return null;
    }

    ctx.log('grounded recommendations ready', {
      candidates: candidates.length,
      returned: recommendations.length,
    });
    return { recommendations, model: ranked.model };
  } catch (err) {
    ctx.warn('grounded ranking failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
