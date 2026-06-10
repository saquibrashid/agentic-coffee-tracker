export async function mockParse(imageBase64: string) {
  // Simulate processing latency
  await new Promise((r) => setTimeout(r, 500));

  // Return a realistic-ish parse result that follows the LLM output contract
  return {
    parsedAt: new Date().toISOString(),
    bean: {
      id: 'mock-bean-1',
      name: 'Mock Roaster Espresso Blend',
      roastDate: null,
      origin: 'Mockland',
      roastLevel: 'medium',
      notes: ['chocolate', 'caramel', 'sweet'],
      image: null,
      metadata: {
        weightGrams: 20,
        brewMethod: 'espresso',
      },
    },
    confidence: 0.92,
    rawText: 'Mock OCR text extracted from image',
  };
}
