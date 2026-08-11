/**
 * Turns what someone pasted into an address worth trying, or `null`.
 *
 * Automatic lookup finds a coffee by working out where its roaster sells, so it
 * can only reach roasters it manages to place. One who is not on a platform it
 * understands is invisible to it, and no amount of improving the guess changes
 * that. Pasting the address is the way out, and the only part of enrichment
 * guaranteed to work for every coffee.
 *
 * People paste what they copied, which is rarely a tidy URL: a bare hostname
 * from the address bar, or a link carrying a page's worth of tracking
 * parameters. Both are fine — the scheme is filled in, and the rest is left
 * exactly as given, since a product page's identity can live in a query
 * parameter and trimming it could fetch a different coffee.
 *
 * The check only has to be good enough to catch a wrong paste before it costs a
 * request. Whether the address is safe to fetch is decided on the server, which
 * is the only place that decision can be trusted.
 */
export function normaliseEnrichUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // A hostname with no dot is a local machine name, not a roaster's website.
  if (!url.hostname.includes('.')) return null;

  return url.toString();
}
