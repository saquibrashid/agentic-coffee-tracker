/**
 * Reading a PDF the user supplied.
 *
 * Some coffees have no product page — a bag from a roaster with no storefront,
 * a subscription insert, a printed spec sheet. The details exist as a document
 * instead, and the parsing step never wanted a web page, only text.
 *
 * Two kinds of PDF arrive here and they are not alike. A PDF produced by
 * software carries its words as text, which can simply be read. A PDF produced
 * by a scanner or a phone carries a *picture* of words, and reading it returns
 * nothing at all — no error, just empty. That silent-empty case is why
 * `pdfHasText` exists: the caller has to be able to tell "this document says
 * nothing" apart from "this document is a photograph", because the second one
 * has a perfectly good answer waiting in the OCR path the camera already uses.
 *
 * pdf.js is loaded on demand and never at startup. It is far larger than
 * anything else the app ships, the byte budget in `lighthouserc.json` is
 * asserted against the pages it would land on, and the overwhelming majority of
 * visits never open a PDF.
 */

/** Only the first pages can plausibly describe the coffee, and a long PDF is not worth reading whole. */
const MAX_PAGES = 5;

/** Rendered larger than displayed: OCR reads a coarse render badly, and this is a one-off cost. */
const OCR_SCALE = 2;

export class PdfReadError extends Error {
  constructor(message = 'That file could not be read as a PDF.') {
    super(message);
    this.name = 'PdfReadError';
  }
}

/**
 * Loads pdf.js and points it at its worker.
 *
 * The worker URL is resolved through `import.meta.url` so the bundler emits it
 * as a same-origin asset. That is not only a packaging detail: the app's
 * Content-Security-Policy allows `worker-src 'self'`, so a worker loaded from
 * anywhere else — a CDN, a blob — would be refused at runtime.
 */
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href;
  return pdfjs;
}

/**
 * Opens the document and hands back the loading task alongside it.
 *
 * The task, not the document, owns the worker — so it is the thing that has to
 * be destroyed. Returning both is what lets every caller close down in a
 * `finally` instead of leaking a worker per PDF opened.
 */
async function openDocument(file: Blob) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  try {
    return { doc: await task.promise, task };
  } catch (err) {
    void task.destroy();
    // Anything from a mislabelled file to an encrypted one lands here, and the
    // distinction does not change what the user can do about it.
    throw new PdfReadError(
      err instanceof Error && /password/i.test(err.message)
        ? 'That PDF is password-protected, so it cannot be read.'
        : undefined,
    );
  }
}

/** Whether there was enough text to be worth parsing, as opposed to a scan. */
export function pdfHasText(text: string): boolean {
  return text.trim().length >= 20;
}

/** Pulls the text layer out of a PDF. Returns '' for a scanned document. */
export async function extractPdfText(file: Blob): Promise<string> {
  const { doc, task } = await openDocument(file);
  try {
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const line = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line) pages.push(line);
    }
    return pages.join('\n\n');
  } finally {
    // Frees the worker; without it every PDF opened leaves one running.
    await task.destroy();
  }
}

/**
 * Renders the first page to an image, so a scanned PDF can go through the same
 * OCR the camera path uses rather than needing a reader of its own.
 */
export async function renderPdfFirstPage(file: Blob): Promise<Blob> {
  const { doc, task } = await openDocument(file);
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: OCR_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new PdfReadError('This browser could not draw the PDF.');

    // White first: PDFs assume paper, and rendering onto transparency turns
    // black text invisible once it is flattened to a JPEG.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, viewport }).promise;

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new PdfReadError('Could not turn that page into an image.')),
        'image/jpeg',
        0.9,
      );
    });
  } finally {
    await task.destroy();
  }
}
