export async function mockOcrFromPhotoBlob(_blob: Blob) {
  return {
    id: 'ocr-1',
    rawText: 'Mock roaster, espresso blend',
    provider: 'MockOCR',
    providerVersion: '1.0.0',
    createdAt: new Date().toISOString(),
  };
}
