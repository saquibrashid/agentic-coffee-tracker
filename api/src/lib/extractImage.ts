/**
 * Picks the product image out of a scraped page.
 *
 * Roaster storefronts are wildly inconsistent, but nearly all of them publish a
 * social-sharing image, and that image is almost always the bag shot we want.
 * So the order below is deliberate: the explicit social metadata first, then
 * the older `link rel="image_src"`, and only then the document body.
 *
 * The body fallback deliberately ignores anything that looks like chrome —
 * logos, icons, sprites, payment badges, tracking pixels — because on a
 * storefront those outnumber the product shot and appear earlier in the markup.
 */

const META_PATTERNS: RegExp[] = [
  // property/name may appear either side of content, so both orders are tried.
  /<meta[^>]+(?:property|name)=["']og:image(?::secure_url|:url)?["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::secure_url|:url)?["']/i,
  /<meta[^>]+(?:property|name)=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']twitter:image(?::src)?["']/i,
  /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i,
];

/** Substrings that mark an image as site furniture rather than the product. */
const JUNK_HINTS = [
  'logo',
  'icon',
  'sprite',
  'placeholder',
  'avatar',
  'badge',
  'banner',
  'payment',
  'spinner',
  'loader',
  'pixel',
  'tracking',
  'favicon',
  '1x1',
  'blank',
];

function looksLikeJunk(url: string): boolean {
  const lower = url.toLowerCase();
  return JUNK_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Shopify and friends serve the same asset at many sizes via a query string or
 * a `_400x` suffix. Those are fine; what we cannot use is an SVG (usually a
 * logo, and not something the canvas pipeline should be handed) or a data URI
 * (already inline, and typically a placeholder).
 */
function isUsableImageUrl(url: string): boolean {
  const withoutQuery = url.split('?')[0]?.toLowerCase() ?? '';
  if (withoutQuery.endsWith('.svg')) return false;
  return true;
}

function firstBodyImage(html: string): string | undefined {
  const imgTags = html.match(/<img[^>]+>/gi) ?? [];
  for (const tag of imgTags) {
    // `data-src` first: lazy-loading storefronts park a placeholder in `src`
    // and only put the real asset in the data attribute.
    const src =
      /(?:data-src|data-original)=["']([^"']+)["']/i.exec(tag)?.[1] ??
      /\ssrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!src) continue;
    if (src.startsWith('data:')) continue;
    if (looksLikeJunk(src)) continue;
    if (!isUsableImageUrl(src)) continue;
    return src;
  }
  return undefined;
}

/**
 * Returns an absolute image URL for the page, or `undefined` when nothing
 * suitable was found.
 *
 * `baseUrl` is the URL the HTML actually came from (after redirects), so that
 * protocol-relative and root-relative sources resolve correctly.
 */
export function extractImageUrl(html: string, baseUrl: string): string | undefined {
  for (const pattern of META_PATTERNS) {
    const candidate = pattern.exec(html)?.[1];
    if (candidate && !candidate.startsWith('data:') && isUsableImageUrl(candidate)) {
      return absolutize(candidate, baseUrl);
    }
  }

  const bodyImage = firstBodyImage(html);
  return bodyImage ? absolutize(bodyImage, baseUrl) : undefined;
}

function absolutize(url: string, baseUrl: string): string | undefined {
  try {
    const resolved = new URL(url, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined;
    return resolved.toString();
  } catch {
    return undefined;
  }
}
