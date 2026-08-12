import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAiError,
  callImageEdit,
  callResponses,
  extractOutputText,
  extractUrlCitations,
  getOpenAiConfig,
  getOpenAiImageConfig,
  parseJsonOutput,
} from './openai.js';

const config = {
  endpoint: 'https://example.openai.azure.com',
  key: 'secret',
  deployment: 'gpt-4o',
};

function responsePayload(text: string): unknown {
  return {
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('getOpenAiConfig', () => {
  it('returns null when any variable is missing', () => {
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://example.openai.azure.com');
    vi.stubEnv('AZURE_OPENAI_KEY', '');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'gpt-4o');
    expect(getOpenAiConfig()).toBeNull();
  });

  it('strips a trailing slash from the endpoint', () => {
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://example.openai.azure.com/');
    vi.stubEnv('AZURE_OPENAI_KEY', 'secret');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'gpt-4o');
    expect(getOpenAiConfig()?.endpoint).toBe('https://example.openai.azure.com');
  });
});

describe('extractOutputText', () => {
  it('reads the assistant message text', () => {
    expect(extractOutputText(responsePayload('{"a":1}'))).toBe('{"a":1}');
  });

  it('ignores non-message output items such as reasoning', () => {
    const payload = {
      output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'ignore me' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'keep me' }] },
      ],
    };
    expect(extractOutputText(payload)).toBe('keep me');
  });

  it('concatenates multiple text parts', () => {
    const payload = {
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '{"a":' }] },
        { type: 'message', content: [{ type: 'output_text', text: '1}' }] },
      ],
    };
    expect(extractOutputText(payload)).toBe('{"a":1}');
  });

  it('returns an empty string for a malformed payload', () => {
    expect(extractOutputText({})).toBe('');
    expect(extractOutputText(null)).toBe('');
  });
});

describe('extractUrlCitations', () => {
  it('reads the sources annotated on the answer', () => {
    const payload = {
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'see here',
              annotations: [
                { type: 'url_citation', url: 'https://example.com/a', title: 'A' },
                { type: 'file_citation', file_id: 'f1' },
              ],
            },
          ],
        },
      ],
    };
    expect(extractUrlCitations(payload)).toEqual([{ url: 'https://example.com/a', title: 'A' }]);
  });

  it('reports a page once however often it is cited', () => {
    const payload = {
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'twice',
              annotations: [
                { type: 'url_citation', url: 'https://example.com/a', title: 'A' },
                { type: 'url_citation', url: 'https://example.com/a', title: 'A' },
              ],
            },
          ],
        },
      ],
    };
    expect(extractUrlCitations(payload)).toHaveLength(1);
  });

  it('returns an empty list when there are no annotations at all', () => {
    expect(extractUrlCitations(responsePayload('plain answer'))).toEqual([]);
    expect(extractUrlCitations(null)).toEqual([]);
  });
});

describe('parseJsonOutput', () => {
  it('parses JSON', () => {
    expect(parseJsonOutput('{"a":1}')).toEqual({ a: 1 });
  });

  it('treats empty output as an empty object', () => {
    expect(parseJsonOutput('')).toEqual({});
  });

  it('returns undefined rather than throwing on invalid JSON', () => {
    expect(parseJsonOutput('not json')).toBeUndefined();
  });
});

describe('callResponses', () => {
  it('posts to the v1 responses route with no api-version', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(responsePayload('{}'))));
    vi.stubGlobal('fetch', fetchMock);

    await callResponses(config, {
      system: 'sys',
      user: 'usr',
      format: { type: 'json_object' },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.openai.azure.com/openai/v1/responses');
    expect(url).not.toContain('api-version');
    expect(url).not.toContain('chat/completions');
    expect((init.headers as Record<string, string>)['api-key']).toBe('secret');
  });

  it('sends a strict schema under text.format and disables the response store', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(responsePayload('{}'))));
    vi.stubGlobal('fetch', fetchMock);

    await callResponses(config, {
      system: 'sys',
      user: 'usr',
      format: { type: 'json_schema', name: 'bean', strict: true, schema: { type: 'object' } },
      temperature: 0,
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.text.format).toEqual({
      type: 'json_schema',
      name: 'bean',
      strict: true,
      schema: { type: 'object' },
    });
    expect(body.response_format).toBeUndefined();
    expect(body.store).toBe(false);
    expect(body.model).toBe('gpt-4o');
    expect(body.input).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  });

  it('lets the caller override the deployment and reports it back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(responsePayload('{}')))),
    );

    const result = await callResponses(config, {
      system: 'sys',
      user: 'usr',
      format: { type: 'json_object' },
      model: 'gpt-4o-mini',
    });

    expect(result.model).toBe('gpt-4o-mini');
  });

  it('throws OpenAiError carrying the upstream status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    );

    await expect(
      callResponses(config, { system: 's', user: 'u', format: { type: 'json_object' } }),
    ).rejects.toThrow(OpenAiError);
  });
});

describe('getOpenAiImageConfig', () => {
  it('is null without an image deployment, even when the chat model is configured', () => {
    // The chat deployment cannot serve /images/edits, so falling back to it
    // would produce a 404 per request instead of an honest mock.
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://example.openai.azure.com');
    vi.stubEnv('AZURE_OPENAI_KEY', 'secret');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'gpt-4o');
    vi.stubEnv('AZURE_OPENAI_IMAGE_DEPLOYMENT', '');
    expect(getOpenAiImageConfig()).toBeNull();
  });

  it('reads its own deployment variable', () => {
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://example.openai.azure.com/');
    vi.stubEnv('AZURE_OPENAI_KEY', 'secret');
    vi.stubEnv('AZURE_OPENAI_IMAGE_DEPLOYMENT', 'gpt-image-1');
    expect(getOpenAiImageConfig()).toEqual({
      endpoint: 'https://example.openai.azure.com',
      key: 'secret',
      deployment: 'gpt-image-1',
    });
  });
});

describe('callImageEdit', () => {
  const imageConfig = { ...config, deployment: 'gpt-image-1' };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  it('posts multipart to the v1 images route without a response_format', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ b64_json: 'aW1n' }] })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await callImageEdit(imageConfig, {
      image: png,
      imageContentType: 'image/png',
      prompt: 'make it nice',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.openai.azure.com/openai/v1/images/edits');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-image-1');
    expect(form.get('prompt')).toBe('make it nice');
    expect(form.get('image')).toBeInstanceOf(Blob);
    // The gpt-image family rejects response_format outright and returns base64
    // regardless, so sending it is both useless and an error.
    expect(form.get('response_format')).toBeNull();
    // Set by fetch from the FormData, boundary and all: writing it by hand
    // would produce a body the service cannot parse.
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('decodes the base64 image and reports the deployment that served it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'aW1n' }] }))),
    );

    const result = await callImageEdit(imageConfig, {
      image: png,
      imageContentType: 'image/png',
      prompt: 'p',
    });

    expect(result.bytes.toString()).toBe('img');
    expect(result.contentType).toBe('image/png');
    expect(result.model).toBe('gpt-image-1');
  });

  it('refuses a response that carries a URL instead of bytes', async () => {
    // The app's CSP allows images from self, data: and blob: only, so a
    // model-hosted URL could never be rendered even if it were durable.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [{ url: 'https://oai/x.png' }] }))),
    );

    await expect(
      callImageEdit(imageConfig, { image: png, imageContentType: 'image/png', prompt: 'p' }),
    ).rejects.toThrow(OpenAiError);
  });

  it('throws OpenAiError carrying the upstream status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('content filtered', { status: 400 })),
    );

    await expect(
      callImageEdit(imageConfig, { image: png, imageContentType: 'image/png', prompt: 'p' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
