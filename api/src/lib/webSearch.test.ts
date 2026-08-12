import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  citationsToHits,
  isPlausibleProductPage,
  isWebSearchEnabled,
  searchWeb,
} from './webSearch.js';

const config = {
  endpoint: 'https://example.openai.azure.com',
  key: 'secret',
  deployment: 'gpt-4o',
};

function ctx() {
  return { log: vi.fn(), warn: vi.fn() };
}

/** A Responses payload carrying the cited pages a web search would annotate. */
function citedPayload(citations: { url: string; title: string }[]): string {
  return JSON.stringify({
    output: [
      { type: 'web_search_call', status: 'completed' },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Here is the page.',
            annotations: citations.map((c) => ({ type: 'url_citation', ...c })),
          },
        ],
      },
    ],
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('isPlausibleProductPage', () => {
  it('accepts a roaster store page', () => {
    expect(isPlausibleProductPage('https://bluebottlecoffee.com/us/eng/product/night-light')).toBe(
      true,
    );
  });

  it('rejects marketplaces, which describe a coffee in someone else’s words', () => {
    expect(isPlausibleProductPage('https://www.amazon.com/dp/B01234')).toBe(false);
    expect(isPlausibleProductPage('https://www.reddit.com/r/coffee/comments/abc')).toBe(false);
  });

  it('rejects anything that is not an http(s) URL', () => {
    expect(isPlausibleProductPage('javascript:alert(1)')).toBe(false);
    expect(isPlausibleProductPage('not a url')).toBe(false);
  });
});

describe('citationsToHits', () => {
  it('scores on the full page title, roaster suffix and all', () => {
    const [hit] = citationsToHits([
      {
        url: 'https://bluebottlecoffee.com/p/night-light',
        title: 'Night Light Decaf - Blue Bottle',
      },
    ]);
    expect(hit?.productTitle).toBe('Night Light Decaf - Blue Bottle');
    expect(hit?.url).toBe('https://bluebottlecoffee.com/p/night-light');
  });

  it('drops a citation with no title, which cannot be ranked', () => {
    expect(citationsToHits([{ url: 'https://example.com/x', title: '' }])).toEqual([]);
  });
});

describe('isWebSearchEnabled', () => {
  it('is on when unset, since a coffee that is not found is the problem being fixed', () => {
    vi.stubEnv('WEB_SEARCH_ENABLED', '');
    expect(isWebSearchEnabled()).toBe(true);
  });

  it('can be switched off without a redeploy', () => {
    vi.stubEnv('WEB_SEARCH_ENABLED', 'false');
    expect(isWebSearchEnabled()).toBe(false);
  });
});

describe('searchWeb', () => {
  it('forces the tool to run rather than letting the model answer from memory', async () => {
    const fetchMock = vi.fn(async () => new Response(citedPayload([])));
    vi.stubGlobal('fetch', fetchMock);

    await searchWeb(config, 'Blue Bottle Coffee', 'Night Light Decaf', 5, ctx());

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.tools).toEqual([{ type: 'web_search', search_context_size: 'medium' }]);
    expect(body.tool_choice).toBe('required');
    expect(body.text).toBeUndefined();
  });

  it('returns the cited product page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            citedPayload([
              {
                url: 'https://bluebottlecoffee.com/us/eng/product/night-light-decaf',
                title: 'Night Light Decaf - Blue Bottle Coffee',
              },
            ]),
          ),
      ),
    );

    const hits = await searchWeb(config, 'Blue Bottle Coffee', 'Night Light Decaf', 5, ctx());

    expect(hits).toHaveLength(1);
    expect(hits[0]?.url).toBe('https://bluebottlecoffee.com/us/eng/product/night-light-decaf');
  });

  it('discards a cited page for a different coffee', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            citedPayload([
              {
                url: 'https://bluebottlecoffee.com/us/eng/product/bella-donovan',
                title: 'Bella Donovan - Blue Bottle Coffee',
              },
            ]),
          ),
      ),
    );

    // Unattended enrichment takes the first candidate without asking anyone, so
    // a near miss must be dropped rather than merely ranked last.
    expect(await searchWeb(config, 'Blue Bottle Coffee', 'Night Light Decaf', 5, ctx())).toEqual(
      [],
    );
  });

  it('ignores URLs in the prose and reads only the annotations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              output: [
                {
                  type: 'message',
                  content: [
                    {
                      type: 'output_text',
                      text: 'Try https://bluebottlecoffee.com/invented/night-light-decaf',
                      annotations: [],
                    },
                  ],
                },
              ],
            }),
          ),
      ),
    );

    expect(await searchWeb(config, 'Blue Bottle Coffee', 'Night Light Decaf', 5, ctx())).toEqual(
      [],
    );
  });

  it('returns nothing rather than throwing when the search fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    );
    const logger = ctx();

    expect(await searchWeb(config, 'Blue Bottle Coffee', 'Night Light Decaf', 5, logger)).toEqual(
      [],
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('caps the results at the requested maximum', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            citedPayload([
              { url: 'https://a.example/1', title: 'Night Light Decaf' },
              { url: 'https://b.example/2', title: 'Night Light Decaf Whole Bean' },
              { url: 'https://c.example/3', title: 'Night Light Decaf Ground' },
            ]),
          ),
      ),
    );

    expect(
      await searchWeb(config, 'Blue Bottle Coffee', 'Night Light Decaf', 2, ctx()),
    ).toHaveLength(2);
  });
});
