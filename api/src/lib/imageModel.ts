/**
 * Thin client for the **Microsoft Foundry MAI image models**.
 *
 * This is deliberately *not* part of `openai.ts`. MAI is a different service on
 * a different host (`*.services.ai.azure.com`, not `*.cognitiveservices.azure.com`)
 * behind a different route (`/mai/v1/images/edits`, not the OpenAI-compatible
 * `/openai/v1/images/edits`), and it is not offered in every region an Azure
 * OpenAI resource can live in. Sharing a module would mean sharing a config
 * shape that does not actually fit.
 *
 * ## Why not gpt-image-1
 *
 * The obvious choice was the image deployment on the existing Azure OpenAI
 * resource, and it was measured before being rejected:
 *
 * | model               | latency     | packaging text |
 * | ------------------- | ----------- | -------------- |
 * | gpt-image-1 `high`  | ~46s        | preserved      |
 * | gpt-image-1 `medium`| ~25s        | **corrupted**  |
 * | MAI-Image-2.5       | ~26s        | preserved      |
 *
 * Static Web Apps enforces a hardcoded, non-configurable **45 second** timeout
 * on calls to a linked backend, and returns `Backend call failure` when it
 * lapses — the function's own 200 is discarded. gpt-image-1 at `high` does not
 * fit inside that window, and at `medium` it renders "Guji Natural" as "Guij
 * Natural" and "250g" as "25og". Trading label accuracy for speed is the one
 * trade this feature cannot make: invented text on packaging is the exact
 * failure the whole design guards against. MAI-Image-2.5 is the combination
 * that fits — `high`-grade fidelity at `medium`-grade latency.
 *
 * Auth is the `api-key` header. The key is injected as a Key Vault reference,
 * so it never sits in the deployed configuration in plaintext.
 */

export interface ImageModelConfig {
  endpoint: string;
  key: string;
  deployment: string;
}

/**
 * Image generation has its own endpoint *and* its own key, unlike every other
 * model call in this API.
 *
 * The chat and OCR models live on one resource; MAI image models are not
 * available in that resource's region at all, so they are a second account in a
 * second region with credentials of their own. Reusing `AZURE_OPENAI_ENDPOINT`
 * would silently point at a host that has no `/mai` route.
 *
 * Returns null when image generation is not configured, which puts the caller
 * in mock mode exactly as the text path does.
 */
export function getImageModelConfig(): ImageModelConfig | null {
  const endpoint = process.env['AZURE_IMAGE_ENDPOINT'];
  const key = process.env['AZURE_IMAGE_KEY'];
  const deployment = process.env['AZURE_IMAGE_DEPLOYMENT'];
  if (!endpoint || !key || !deployment) return null;
  return { endpoint: endpoint.replace(/\/$/, ''), key, deployment };
}

export interface ImageEditRequest {
  /** The reference image the model must reproduce the packaging from. */
  image: Buffer;
  imageContentType: string;
  prompt: string;
  timeoutMs?: number;
}

export interface ImageEditResult {
  /** Raw bytes of the generated image. */
  bytes: Buffer;
  contentType: string;
  model: string;
}

/**
 * Edits an image with the deployed MAI image model.
 *
 * `multipart/form-data` rather than JSON, because that is what the edits route
 * accepts — the reference image is an uploaded file, not a base64 field. Only
 * `model`, `prompt` and `image` are sent: the edits API takes its dimensions
 * from the reference image, and the `size`/`quality` knobs of the OpenAI image
 * API do not exist here.
 *
 * Generation is slow by the standards of the other endpoints — tens of seconds
 * is normal — so the default timeout is far longer than the 30s the text calls
 * use. It is nonetheless kept under Static Web Apps' own 45s ceiling: once the
 * front door has given up, finishing the work only spends money on a result
 * nobody will ever receive.
 */
export async function callImageEdit(
  config: ImageModelConfig,
  request: ImageEditRequest,
): Promise<ImageEditResult> {
  const form = new FormData();
  form.append('model', config.deployment);
  form.append('prompt', request.prompt);
  form.append(
    'image',
    new Blob([new Uint8Array(request.image)], { type: request.imageContentType }),
    'reference.png',
  );

  const res = await fetch(`${config.endpoint}/mai/v1/images/edits`, {
    method: 'POST',
    // No Content-Type header: fetch derives it from the FormData, including the
    // multipart boundary, which cannot be written by hand.
    headers: { 'api-key': config.key },
    signal: AbortSignal.timeout(request.timeoutMs ?? 40_000),
    body: form,
  });

  if (!res.ok) throw new ImageModelError(res.status, await res.text());

  const data = (await res.json()) as {
    data?: { b64_json?: string; url?: string }[];
    output_format?: string;
  };
  const b64 = data.data?.[0]?.b64_json;
  // A URL instead of bytes would be useless here: the app's CSP allows images
  // from `self`, `data:` and `blob:` only, so a temporary model-hosted URL could
  // never be displayed. Treat it as a failure rather than pass it on.
  if (!b64) throw new ImageModelError(502, 'Image response carried no image data.');

  const format = data.output_format === 'jpeg' ? 'jpeg' : (data.output_format ?? 'png');
  return {
    bytes: Buffer.from(b64, 'base64'),
    contentType: `image/${format}`,
    model: config.deployment,
  };
}

export class ImageModelError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Image model returned ${status}: ${body}`);
    this.name = 'ImageModelError';
  }
}
