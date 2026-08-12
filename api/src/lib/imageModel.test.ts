import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageModelError, callImageEdit, getImageModelConfig } from './imageModel.js';

const imageConfig = {
  endpoint: 'https://example.services.ai.azure.com',
  key: 'secret',
  deployment: 'MAI-Image-2.5',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('getImageModelConfig', () => {
  it('is null when only the chat resource is configured', () => {
    // The image model lives on a different account in a different region, and
    // the Azure OpenAI host has no /mai route at all — falling back to it would
    // produce a 404 per request instead of an honest mock.
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://example.openai.azure.com');
    vi.stubEnv('AZURE_OPENAI_KEY', 'secret');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'gpt-4o');
    vi.stubEnv('AZURE_IMAGE_ENDPOINT', '');
    vi.stubEnv('AZURE_IMAGE_KEY', '');
    vi.stubEnv('AZURE_IMAGE_DEPLOYMENT', '');
    expect(getImageModelConfig()).toBeNull();
  });

  it('is null when the endpoint is set but the key is missing', () => {
    vi.stubEnv('AZURE_IMAGE_ENDPOINT', 'https://example.services.ai.azure.com');
    vi.stubEnv('AZURE_IMAGE_KEY', '');
    vi.stubEnv('AZURE_IMAGE_DEPLOYMENT', 'MAI-Image-2.5');
    expect(getImageModelConfig()).toBeNull();
  });

  it('reads its own endpoint, key and deployment', () => {
    vi.stubEnv('AZURE_IMAGE_ENDPOINT', 'https://example.services.ai.azure.com/');
    vi.stubEnv('AZURE_IMAGE_KEY', 'image-secret');
    vi.stubEnv('AZURE_IMAGE_DEPLOYMENT', 'MAI-Image-2.5');
    expect(getImageModelConfig()).toEqual({
      endpoint: 'https://example.services.ai.azure.com',
      key: 'image-secret',
      deployment: 'MAI-Image-2.5',
    });
  });
});

describe('callImageEdit', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  it('posts multipart to the MAI edits route', async () => {
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
    // Not the OpenAI-compatible /openai/v1/images/edits: MAI models are
    // rejected there with "Model not supported with Responses API".
    expect(url).toBe('https://example.services.ai.azure.com/mai/v1/images/edits');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('model')).toBe('MAI-Image-2.5');
    expect(form.get('prompt')).toBe('make it nice');
    expect(form.get('image')).toBeInstanceOf(Blob);
    // The edits API takes its dimensions from the reference image; these are
    // OpenAI image knobs that do not exist here.
    expect(form.get('size')).toBeNull();
    expect(form.get('quality')).toBeNull();
    // Set by fetch from the FormData, boundary and all: writing it by hand
    // would produce a body the service cannot parse.
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('authenticates with the image resource key, not the chat one', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ b64_json: 'aW1n' }] })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await callImageEdit(imageConfig, { image: png, imageContentType: 'image/png', prompt: 'p' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['api-key']).toBe('secret');
  });

  it('gives up before the front door does', async () => {
    // Static Web Apps abandons a linked-backend call at 45s and returns
    // "Backend call failure". Finishing after that only spends money on an
    // image nobody will ever receive.
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ b64_json: 'aW1n' }] })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await callImageEdit(imageConfig, { image: png, imageContentType: 'image/png', prompt: 'p' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
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
    expect(result.model).toBe('MAI-Image-2.5');
  });

  it('honours a jpeg output format', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ b64_json: 'aW1n' }], output_format: 'jpeg' })),
      ),
    );

    const result = await callImageEdit(imageConfig, {
      image: png,
      imageContentType: 'image/png',
      prompt: 'p',
    });

    expect(result.contentType).toBe('image/jpeg');
  });

  it('refuses a response that carries a URL instead of bytes', async () => {
    // The app's CSP allows images from self, data: and blob: only, so a
    // model-hosted URL could never be rendered even if it were durable.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [{ url: 'https://mai/x.png' }] }))),
    );

    await expect(
      callImageEdit(imageConfig, { image: png, imageContentType: 'image/png', prompt: 'p' }),
    ).rejects.toThrow(ImageModelError);
  });

  it('throws ImageModelError carrying the upstream status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('content filtered', { status: 400 })),
    );

    await expect(
      callImageEdit(imageConfig, { image: png, imageContentType: 'image/png', prompt: 'p' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('preserves a throttle status so the caller can retry rather than give up', async () => {
    // Capacity is one image per minute, so a bulk run overlapping an
    // interactive re-shoot is enough to hit this.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    );

    await expect(
      callImageEdit(imageConfig, { image: png, imageContentType: 'image/png', prompt: 'p' }),
    ).rejects.toMatchObject({ status: 429 });
  });
});
