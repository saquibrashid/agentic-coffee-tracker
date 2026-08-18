/**
 * Bag and product texts used to compare candidate models (issue #223).
 *
 * These are real-world shapes rather than tidy synthetic prompts, because the
 * prompt in `parsePrompt.ts` explicitly has to cope with all of them: OCR
 * fragments off a label, a scraped product page, a datasheet, and prose a user
 * pasted. A model that handles clean label text and falls over on prose would
 * look fine on a synthetic set and fail in the capture flow.
 *
 * `expect` records only what the text actually supports. Where a field is
 * genuinely absent the expectation is `null`, so a model that invents a
 * plausible value is scored wrong — inventing detail is worse than omitting it
 * when the result is written to the user's library as fact.
 */

export const CASES = [
  {
    id: 'label-onyx-geometry',
    shape: 'label fragments',
    text: `ONYX COFFEE LAB
GEOMETRY
BLEND
MEDIUM ROAST
MILK CHOCOLATE, ORANGE, ALMOND
12 OZ (340g)
ROASTED 2026-05-14`,
    expect: {
      roaster: 'Onyx Coffee Lab',
      name: 'Geometry',
      country: null,
      process: null,
      roastLevel: 'medium',
      notes: ['milk chocolate', 'orange', 'almond'],
      roastDate: '2026-05-14',
      descriptionExpected: false,
    },
  },
  {
    id: 'label-ethiopia-guji',
    shape: 'single origin label',
    text: `LA CABRA
ETHIOPIA — GUJI
Shakiso, Oromia
Washed
Varietal: Heirloom
Altitude: 1950-2100 masl
Light roast
Notes of jasmine, bergamot and white peach`,
    expect: {
      roaster: 'La Cabra',
      name: 'Ethiopia Guji',
      country: 'Ethiopia',
      process: 'washed',
      roastLevel: 'light',
      notes: ['jasmine', 'bergamot', 'white peach'],
      roastDate: null,
      descriptionExpected: false,
    },
  },
  {
    id: 'prose-about-paragraph',
    shape: 'roaster prose (the regression case)',
    text: `Konga is named for the washing station in the Yirgacheffe region where these
cherries are delivered. Smallholders farming less than a hectare each bring
their harvest to the station, where it is depulped and fermented under water
for 36 hours before being dried on raised beds. We roast it light to keep the
florals intact. Free shipping on orders over $40. Subscribe and save 10%.`,
    expect: {
      roaster: null,
      name: 'Konga',
      country: 'Ethiopia',
      process: 'washed',
      roastLevel: 'light',
      notes: [],
      roastDate: null,
      descriptionExpected: true,
    },
  },
  {
    id: 'product-page-blend',
    shape: 'scraped product page',
    text: `Counter Culture Coffee | Big Trouble
$17.00 USD
A comforting blend of Latin American coffees. Caramel, toasted nut and cocoa.
Roast: Medium-light
Components: Colombia (60%), Guatemala (40%)
Process: Washed
Add to cart. Ships Monday.`,
    expect: {
      roaster: 'Counter Culture Coffee',
      name: 'Big Trouble',
      country: 'Colombia',
      process: 'washed',
      roastLevel: 'medium-light',
      notes: ['caramel', 'toasted nut', 'cocoa'],
      roastDate: null,
      descriptionExpected: true,
    },
  },
  {
    id: 'datasheet-anaerobic',
    shape: 'datasheet',
    text: `PRODUCER: Finca El Paraiso
COUNTRY: Colombia
REGION: Cauca
VARIETAL: Castillo
PROCESS: Anaerobic natural
ELEVATION: 1930 masl
CUPPING: lychee, rose, red apple
SUGGESTED ROAST: Medium`,
    expect: {
      roaster: null,
      name: null,
      country: 'Colombia',
      process: 'anaerobic',
      roastLevel: 'medium',
      notes: ['lychee', 'rose', 'red apple'],
      roastDate: null,
      descriptionExpected: false,
    },
  },
  {
    id: 'ocr-noisy',
    shape: 'noisy OCR',
    text: `STUMPT0WN C0FFEE R0ASTERS
HAIR BENDER
Espresso Blend
Ind0nesia * Latin America * Africa
DARK CHERRY | HAZELNUT
NET WT 12 0Z`,
    expect: {
      roaster: 'Stumptown Coffee Roasters',
      name: 'Hair Bender',
      country: 'Indonesia',
      process: null,
      roastLevel: null,
      notes: ['dark cherry', 'hazelnut'],
      roastDate: null,
      descriptionExpected: false,
    },
  },
  {
    id: 'sparse-label',
    shape: 'almost nothing (invention trap)',
    text: `SEY COFFEE
BROOKLYN, NY
250g whole bean`,
    expect: {
      roaster: 'Sey Coffee',
      name: null,
      country: null,
      process: null,
      roastLevel: null,
      notes: [],
      roastDate: null,
      descriptionExpected: false,
    },
  },
  {
    id: 'honey-process-wide',
    shape: 'label with process wording that needs normalising',
    text: `TIM WENDELBOE
EL DESARROLLO
Colombia, Huila
Yellow honey processed
Roasted for filter — very light
Notes: peach, cane sugar, jasmine`,
    expect: {
      roaster: 'Tim Wendelboe',
      name: 'El Desarrollo',
      country: 'Colombia',
      process: 'honey',
      roastLevel: 'light',
      notes: ['peach', 'cane sugar', 'jasmine'],
      roastDate: null,
      descriptionExpected: false,
    },
  },
];
