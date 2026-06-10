export async function mockOcrFromPhotoBlob(blob: Blob) {
  // Simulate OCR latency
  await new Promise((r) => setTimeout(r, 400));
  // Return a minimal OCR result
  return {
    id: `mock-ocr-${Date.now()}`,
    rawText: 'Mock OCR extracted text: Bag label with roaster and tasting notes',
    provider: 'mock-vision',
    providerVersion: '0.1',
    createdAt: new Date().toISOString(),
  };
}
