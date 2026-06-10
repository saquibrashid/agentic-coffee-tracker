export async function mockParse(_imageBase64: string) {
  return {
    bean: {
      name: 'Espresso Blend',
      roaster: 'Mock Roaster',
      origin: 'Unknown',
    },
    confidence: 0.95,
    rawText: 'Mock Roaster Espresso Blend',
  };
}
