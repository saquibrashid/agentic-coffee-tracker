/**
 * Vocabulary tables that let the predictor recognise history it already has.
 *
 * The predictor matched every attribute by exact normalised string, so a bag
 * offering "Green Apple" learned nothing from a shelf of coffees the user had
 * rated as "apple", "crisp apple" and "orchard fruit" (#235). That is not a
 * thin-history problem, it is a vocabulary problem, and it was expensive twice
 * over: the evidence was dropped, and confidence multiplies by how many
 * attribute kinds were recognised, so one unmatched word cost a fifth of it.
 *
 * These tables are deliberately local and hand-written. The predictor's whole
 * argument (see `predict.ts`) is that a claim about your own palate should be
 * checkable arithmetic on your own history — so the thing that decides whether
 * two coffees are related has to be inspectable and testable too, not a model
 * call that answers differently on Tuesday.
 *
 * They are not meant to be exhaustive. Tasting notes are open vocabulary and
 * always will be; this covers the vocabulary roasters actually reach for, and
 * anything it misses degrades exactly as before — reported honestly as "nothing
 * rated yet" rather than guessed at.
 */

/** Lowercase, strip punctuation, collapse whitespace. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Origin countries grouped by what they tend to taste like, not by geography
 * for its own sake.
 *
 * Brazil is deliberately alone rather than filed under South America: a heavy,
 * nutty, low-acid Brazilian natural says very little about a bright washed
 * Colombian, and lumping them together would manufacture evidence rather than
 * find it. A family of one simply never matches, which is the correct answer.
 */
const ORIGIN_FAMILIES: Record<string, string[]> = {
  'East Africa': [
    'ethiopia',
    'kenya',
    'rwanda',
    'burundi',
    'tanzania',
    'uganda',
    'congo',
    'drc',
    'democratic republic of congo',
    'zambia',
    'malawi',
  ],
  'Central America': [
    'guatemala',
    'costa rica',
    'honduras',
    'el salvador',
    'nicaragua',
    'panama',
    'mexico',
    'belize',
  ],
  'Andean South America': ['colombia', 'peru', 'ecuador', 'bolivia', 'venezuela'],
  Brazil: ['brazil'],
  'Island & Caribbean': [
    'jamaica',
    'hawaii',
    'kona',
    'puerto rico',
    'dominican republic',
    'cuba',
    'haiti',
  ],
  'Indonesia & Pacific': [
    'indonesia',
    'sumatra',
    'java',
    'sulawesi',
    'bali',
    'flores',
    'papua new guinea',
    'png',
    'timor',
    'east timor',
    'philippines',
  ],
  'Asia mainland': ['india', 'vietnam', 'thailand', 'china', 'yunnan', 'laos', 'myanmar', 'nepal'],
  Arabia: ['yemen', 'saudi arabia'],
};

/**
 * Tasting-note families, roughly the coarse rings of the SCA flavour wheel.
 *
 * Matching is by whole word, so "apple" does not fire on "pineapple", and the
 * longest phrase wins, so "green apple" lands in Apple & pear rather than being
 * caught by "green" in the savoury family.
 */
const FLAVOUR_FAMILIES: Record<string, string[]> = {
  Berry: [
    'berry',
    'berries',
    'blueberry',
    'blackberry',
    'raspberry',
    'strawberry',
    'cranberry',
    'boysenberry',
    'mulberry',
    'blackcurrant',
    'black currant',
    'currant',
    'cassis',
  ],
  'Stone fruit': [
    'stone fruit',
    'stonefruit',
    'peach',
    'nectarine',
    'apricot',
    'plum',
    'cherry',
    'cherries',
  ],
  Citrus: [
    'citrus',
    'citric',
    'orange',
    'tangerine',
    'mandarin',
    'clementine',
    'lemon',
    'lime',
    'grapefruit',
    'bergamot',
    'yuzu',
  ],
  'Apple & pear': [
    'apple',
    'green apple',
    'red apple',
    'crisp apple',
    'apple juice',
    'orchard fruit',
    'pear',
    'quince',
  ],
  'Tropical fruit': [
    'tropical',
    'tropical fruit',
    'mango',
    'papaya',
    'pineapple',
    'passion fruit',
    'passionfruit',
    'guava',
    'lychee',
    'banana',
    'coconut',
    'melon',
    'watermelon',
    'cantaloupe',
  ],
  'Dried fruit': [
    'dried fruit',
    'raisin',
    'sultana',
    'fig',
    'date',
    'prune',
    'dried cherry',
    'dried apricot',
  ],
  'Wine & ferment': [
    'grape',
    'wine',
    'winey',
    'winy',
    'red wine',
    'white wine',
    'port',
    'sherry',
    'muscat',
    'jammy',
    'boozy',
    'rum',
    'whiskey',
    'whisky',
    'brandy',
    'fermented',
    'funky',
    'cider',
  ],
  Floral: [
    'floral',
    'flower',
    'flowers',
    'jasmine',
    'rose',
    'hibiscus',
    'lavender',
    'chamomile',
    'elderflower',
    'honeysuckle',
    'orange blossom',
    'magnolia',
    'violet',
    'potpourri',
  ],
  Chocolate: [
    'chocolate',
    'chocolatey',
    'cocoa',
    'cacao',
    'dark chocolate',
    'milk chocolate',
    'fudge',
    'brownie',
    'mocha',
  ],
  'Caramel & sugar': [
    'caramel',
    'toffee',
    'butterscotch',
    'brown sugar',
    'molasses',
    'maple',
    'maple syrup',
    'honey',
    'syrup',
    'cane sugar',
    'sugar',
    'sweet',
    'marshmallow',
    'vanilla',
    'candy',
    'confection',
  ],
  Nutty: [
    'nut',
    'nuts',
    'nutty',
    'almond',
    'hazelnut',
    'peanut',
    'pecan',
    'walnut',
    'cashew',
    'marzipan',
    'praline',
    'nougat',
  ],
  Spice: [
    'spice',
    'spiced',
    'spicy',
    'cinnamon',
    'clove',
    'nutmeg',
    'cardamom',
    'ginger',
    'pepper',
    'black pepper',
    'allspice',
    'anise',
    'licorice',
    'liquorice',
  ],
  'Herbal & tea': [
    'herbal',
    'herb',
    'tea',
    'black tea',
    'green tea',
    'earl grey',
    'mint',
    'peppermint',
    'spearmint',
    'sage',
    'thyme',
    'basil',
    'lemongrass',
  ],
  'Roast & grain': [
    'roasty',
    'roasted',
    'smoke',
    'smoky',
    'smokey',
    'toast',
    'toasted',
    'burnt',
    'char',
    'charred',
    'ash',
    'tobacco',
    'cedar',
    'wood',
    'woody',
    'oak',
    'malt',
    'malty',
    'graham cracker',
    'biscuit',
    'bread',
    'cereal',
    'grain',
    'toasted nut',
  ],
  'Savoury & earthy': [
    'earthy',
    'earth',
    'savoury',
    'savory',
    'umami',
    'mushroom',
    'soy',
    'herbaceous',
    'vegetal',
    'green',
    'grassy',
    'hay',
    'straw',
    'leather',
    'musty',
    'rubber',
    'medicinal',
    'phenolic',
  ],
  'Dairy & butter': [
    'butter',
    'buttery',
    'cream',
    'creamy',
    'milk',
    'yoghurt',
    'yogurt',
    'custard',
    'cheesecake',
  ],
  'Bright & juicy': [
    'acidity',
    'acidic',
    'bright',
    'juicy',
    'tart',
    'sour',
    'crisp',
    'sparkling',
    'effervescent',
    'lively',
    'zesty',
    'tangy',
    'vibrant',
  ],
};

interface Keyword {
  family: string;
  pattern: RegExp;
}

/**
 * Longest keyword first, so a multi-word phrase always beats a single word it
 * contains. Without this the order of `Object.keys` would silently decide
 * whether "green apple" is a fruit or a vegetable.
 */
function compile(families: Record<string, string[]>): Keyword[] {
  return Object.entries(families)
    .flatMap(([family, keywords]) => keywords.map((keyword) => ({ family, keyword })))
    .sort((a, b) => b.keyword.length - a.keyword.length)
    .map(({ family, keyword }) => ({
      family,
      // Whole-word only: "apple" must not fire on "pineapple".
      pattern: new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
    }));
}

const ORIGIN_KEYWORDS = compile(ORIGIN_FAMILIES);
const FLAVOUR_KEYWORDS = compile(FLAVOUR_FAMILIES);

function lookup(keywords: Keyword[], value: string): string | null {
  const text = normalise(value);
  if (!text) return null;
  for (const { family, pattern } of keywords) {
    if (pattern.test(text)) return family;
  }
  return null;
}

/** The tasting family a note belongs to, or null when nothing recognises it. */
export function flavourFamily(note: string): string | null {
  return lookup(FLAVOUR_KEYWORDS, note);
}

/** The producing region a country belongs to, or null when unrecognised. */
export function originFamily(country: string): string | null {
  return lookup(ORIGIN_KEYWORDS, country);
}

/**
 * Processing methods ordered by how much fruit and fermentation character they
 * leave in the cup.
 *
 * Unlike origins and notes this is not a family table, because `Process` is
 * already a closed set of five values the app itself defines — there is no
 * vocabulary to normalise. What it lacks is the same thing roast level lacked
 * before #200: these are not unrelated labels. Someone who rates naturals
 * highly is telling you something about how they will feel about an anaerobic.
 *
 * `wet-hulled` and `other` are deliberately off the scale. Wet-hulling produces
 * a heavy, earthy cup that does not sit anywhere on a fruit-intensity axis, and
 * placing it somewhere for the sake of completeness would invent evidence.
 */
export const PROCESS_ORDER = ['washed', 'honey', 'natural', 'anaerobic'] as const;

/**
 * How much a neighbouring process counts, by steps away. Steeper than roast
 * level's, because one step here is a larger jump than one step on a roast
 * scale: washed to honey changes the cup more than medium to medium-dark does.
 */
export const PROCESS_NEIGHBOUR_DISCOUNT = [1, 0.55, 0.25, 0.1];
