/**
 * Recovers product details from pages that render themselves in the browser.
 *
 * Scraping assumes the words are in the HTML. On a storefront built as a
 * single-page app they are not: the server sends a shell of script tags and the
 * page assembles itself once JavaScript runs. Stripping the tags off one of
 * those leaves nothing at all, so a coffee with a perfectly good product page
 * enriches to blank — Blue Bottle is the case that surfaced this, and it is a
 * whole class of roaster rather than one awkward site.
 *
 * The data is still there, just not as text: these frameworks serialise the
 * page's state into a JSON script block so the browser can carry on where the
 * server left off. Reading that is the difference between "we cannot see this
 * page" and seeing exactly what the visitor sees.
 *
 * The hazard is picking the wrong coffee. A product page carries its
 * recommendations in the same blob, and they sit *ahead* of the product itself
 * — flattening it wholesale yields three unrelated coffees before the one that
 * was asked for. Since enrichment can apply a result without anyone reading it,
 * that would quietly overwrite a coffee's details with a neighbour's. So this
 * identifies the product first and reads only from it, and returns nothing at
 * all rather than something plausible.
 */

/** Field names that carry a coffee's own details across storefront platforms. */
const PRODUCT_FIELDS = new Set([
  'name',
  'title',
  'subtitle',
  'heading',
  'description',
  'descriptionv2',
  'descriptionhtml',
  'details',
  'flavorprofile',
  'flavornotes',
  'tastingnotes',
  'notes',
  'roastlevel',
  'roast',
  'processing',
  'process',
  'origin',
  'origins',
  'producer',
  'varietal',
  'variety',
  'elevation',
  'altitude',
  'region',
  'country',
  'farm',
  'primaryshopcollectionname',
  'keyvaluelist',
  'label',
  'value',
  'producttype',
]);

/** Guards against a hostile or pathological document walking forever. */
const MAX_NODES = 200_000;
const MAX_DEPTH = 40;

interface Scored {
  score: number;
  node: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The slug the URL is asking for — the part that names the product.
 *
 * Both `/products/holler-mountain` and `/us/eng/product/night-light-decaf` end
 * in it, which is what makes it a reliable way to tell the product apart from
 * everything else the page happens to be carrying.
 */
export function slugFromUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return null;
  const slug = last.replace(/\.[a-z0-9]{1,5}$/i, '').toLowerCase();
  return slug.length > 0 ? slug : null;
}

function slugOf(node: Record<string, unknown>): string | null {
  const slug = node['slug'];
  if (typeof slug === 'string') return slug.toLowerCase();
  // Some content platforms wrap it: `{ slug: { current: "..." } }`.
  if (isRecord(slug)) {
    const current = slug['current'];
    if (typeof current === 'string') return current.toLowerCase();
  }
  const handle = node['handle'];
  if (typeof handle === 'string') return handle.toLowerCase();
  return null;
}

/**
 * Finds the node describing the product the URL names.
 *
 * Several nodes can claim the same slug — the routing wrapper around the page
 * does, and it knows nothing about coffee. So every match is scored by how many
 * product fields it actually carries and the richest one wins, which is the
 * product itself rather than the envelope it arrived in.
 */
export function findProductNode(data: unknown, slug: string): Record<string, unknown> | null {
  const matches: Scored[] = [];
  let visited = 0;

  const walk = (node: unknown, depth: number): void => {
    if (visited++ > MAX_NODES || depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (!isRecord(node)) return;

    if (slugOf(node) === slug) {
      const score = Object.keys(node).filter((key) => PRODUCT_FIELDS.has(key.toLowerCase())).length;
      matches.push({ score, node });
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  };

  walk(data, 0);
  if (matches.length === 0) return null;

  matches.sort((a, b) => b.score - a.score);
  const best = matches[0];
  // A node that matched the slug but describes nothing is the page wrapper, not
  // the product. Better to report nothing than to hand back a routing envelope.
  return best && best.score >= 2 ? best.node : null;
}

/** Collects the readable strings out of a value, however deeply it is wrapped. */
function flatten(value: unknown, out: string[], depth = 0): void {
  if (depth > MAX_DEPTH || out.length > 500) return;
  if (typeof value === 'string') {
    const text = value.trim();
    // Long strings are prose worth having; very long ones are markup or data.
    if (text.length > 0 && text.length <= 600) out.push(text);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    // Underscored keys are the platform's own bookkeeping — revisions, types,
    // internal ids — and never describe the coffee.
    if (key.startsWith('_') || key === 'slug' || key === 'handle') continue;
    flatten(nested, out, depth + 1);
  }
}

/**
 * Fields whose name means one thing to a coffee and another to a website.
 *
 * "Region" is where a coffee was grown, and also which storefront locale the
 * visitor is on; "country" likewise. The two are easy to tell apart, because a
 * growing region is a place name and a locale is an ISO code — so anything too
 * short to be a place is the website talking, and letting `region: us` through
 * would invite the parser to record a coffee as grown in the United States.
 */
const AMBIGUOUS_PLACE_FIELDS = new Set(['region', 'country']);

/** Renders a product node as the plain text the parser expects. */
export function productNodeToText(product: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(product)) {
    const lower = key.toLowerCase();
    if (!PRODUCT_FIELDS.has(lower)) continue;
    const collected: string[] = [];
    flatten(value, collected);

    const meaningful = AMBIGUOUS_PLACE_FIELDS.has(lower)
      ? collected.filter((text) => text.length > 3)
      : collected;

    const seen = new Set<string>();
    const unique = meaningful.filter((text) => {
      const fingerprint = text.toLowerCase();
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    });
    if (unique.length > 0) lines.push(`${key}: ${unique.join(', ')}`);
  }

  return lines.join('\n');
}

const IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp|avif)(?:$|[?#])/i;

/** Picks a product image out of the same node, when one is in there. */
export function productNodeToImageUrl(product: Record<string, unknown>): string | undefined {
  const urls: string[] = [];
  let visited = 0;

  const walk = (value: unknown, depth: number): void => {
    if (visited++ > MAX_NODES || depth > MAX_DEPTH || urls.length > 0) return;
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value) && IMAGE_EXTENSIONS.test(value)) urls.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    // Prefer the secure URL where a CDN offers both, so the result is fetchable.
    const secure = value['secure_url'];
    if (typeof secure === 'string' && IMAGE_EXTENSIONS.test(secure)) {
      urls.push(secure);
      return;
    }
    for (const nested of Object.values(value)) walk(nested, depth + 1);
  };

  const images = product['images'] ?? product['image'] ?? product;
  walk(images, 0);
  return urls[0];
}

/** Every JSON payload the page embedded, parsed and ready to search. */
function embeddedJsonBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern =
    /<script\b[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const body = match[1]?.trim();
    if (!body) continue;
    try {
      blocks.push(JSON.parse(body));
    } catch {
      // A block that will not parse is not worth reporting: pages routinely
      // embed templated JSON that was never valid to begin with.
    }
  }
  return blocks;
}

/**
 * Reads schema.org Product markup, which is the case worth trying first.
 *
 * It is a published standard rather than one framework's internals, so when a
 * page has it, it is both the most reliable description of the product and the
 * least likely to include anything else on the page.
 */
export function productFromJsonLd(block: unknown): Record<string, unknown> | null {
  const queue: unknown[] = [block];
  let visited = 0;

  while (queue.length > 0) {
    const node = queue.shift();
    if (visited++ > 1000) break;
    if (Array.isArray(node)) {
      for (const item of node as unknown[]) queue.push(item);
      continue;
    }
    if (!isRecord(node)) continue;

    const type = node['@type'];
    const types: unknown[] = Array.isArray(type) ? (type as unknown[]) : [type];
    if (types.some((entry) => typeof entry === 'string' && entry.toLowerCase() === 'product')) {
      return node;
    }
    if (node['@graph']) queue.push(node['@graph']);
  }
  return null;
}

export interface EmbeddedProduct {
  text: string;
  imageUrl?: string;
}

/**
 * Pulls the product out of a page whose HTML carried no readable text.
 *
 * Returns `null` when nothing can be identified with confidence, which the
 * caller should treat exactly as it treats an empty page.
 */
export function extractEmbeddedProduct(html: string, url: string): EmbeddedProduct | null {
  const blocks = embeddedJsonBlocks(html);
  if (blocks.length === 0) return null;

  for (const block of blocks) {
    const jsonLd = productFromJsonLd(block);
    if (!jsonLd) continue;
    const text = productNodeToText(jsonLd);
    if (text.length > 0) {
      const imageUrl = productNodeToImageUrl(jsonLd);
      return imageUrl ? { text, imageUrl } : { text };
    }
  }

  const slug = slugFromUrl(url);
  if (!slug) return null;

  for (const block of blocks) {
    const product = findProductNode(block, slug);
    if (!product) continue;
    const text = productNodeToText(product);
    if (text.length > 0) {
      const imageUrl = productNodeToImageUrl(product);
      return imageUrl ? { text, imageUrl } : { text };
    }
  }

  return null;
}
