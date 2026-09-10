/**
 * The instruction that turns text about a coffee into structured fields.
 *
 * Lives beside the schema rather than inside the function so it can be tested,
 * the way `webSearch.ts` keeps its own prompt. The two are a pair: this frames
 * the task, and `PARSED_BEAN_SCHEMA` carries the per-field guidance.
 *
 * The text reaching `/api/parse` is not always a bag label. `enrichFromText`
 * sends prose the user pasted, `enrichFromUrl` sends a scraped product page and
 * the PDF path sends a datasheet — all through `parse({ ocrText })`.
 *
 * Calling all of that "OCR text of a coffee bag" lost real data: given a
 * roaster's About paragraph, the model returned a name and roaster and left
 * `roasterDescription` null, because a bag label carries no field called
 * "description" and an instruction not to guess resolves ties towards null.
 * Naming the possible sources, and saying that prose about the coffee *is* the
 * description, is what gives that paragraph somewhere to land.
 *
 * The second addition came from the opposite failure. A coffee added from a
 * Cometeer "build your own box" page came back with some fifty origins, a site
 * tagline as the roaster's description and "incredible coffee" as a tasting
 * note. The model was not malfunctioning: it had been handed a page describing
 * forty coffees and told in the first sentence that the text was about one, and
 * merging was the only reading that instruction allows. Nothing structural in
 * the page said otherwise — it carried a single schema.org Product block naming
 * the box rather than any coffee — so the model is the only thing in the chain
 * that can see there are forty coffees on the page, and it has to be told that
 * noticing is allowed.
 *
 * The third came from the same box, photographed rather than scraped. The word
 * "Cometeer" is printed on it and the OCR read it, but the schema had nowhere
 * to put it, so the only name that survived was the roaster the enrichment
 * search then found — and the coffee lost every trace of the form it came in.
 *
 * That field was first modelled as a *seller*, which was wrong and briefly
 * shipped as one. Cometeer flash-freezes other roasters' brewed coffee into
 * pucks; a Cometeer box of Counter Culture coffee is Counter Culture's coffee,
 * delivered frozen. The shop in that case was a Sprouts grocery store, and
 * where a coffee was bought says nothing about the coffee. Asking for the
 * seller made the model's job to find one — against a receipt or an Amazon
 * listing it would have found exactly the noise nobody wanted. The question is
 * therefore what *form* the coffee arrives in, answered from a closed enum, so
 * that a shop name has nowhere to land even if the model tries.
 */
export const PARSE_SYSTEM_PROMPT = `You extract structured coffee bean metadata from text about a single coffee. The text may be OCR of a bag label, a roaster's product page, a datasheet, or details a user pasted in, so it ranges from a few label fragments to several paragraphs of prose.

Sometimes the text is not about one coffee at all. A shop's listing page, a "build your own box" page, a category page or a page whose navigation and recommendations swamp the product will describe many different coffees side by side. When you cannot tell which single coffee the text is about, say so by returning nulls and empty lists rather than combining several coffees into one. Merging them produces a coffee that does not exist — a dozen origins, flavour notes from unrelated beans — and that is worse than returning nothing, because nothing is visibly nothing while a merge looks like an answer. Return details only when the text is dominated by one coffee, and never assemble a coffee from parts of several.

Return ONLY fields present in or strongly implied by the text. Use null for anything unknown — do not invent details the text does not support. Normalize roast level and process to the provided enums. Output must match the supplied JSON schema exactly.

Caffeine deserves particular care, because the absence of a statement is not evidence. Ordinary coffee does not label itself "caffeinated" — it simply says nothing — so return null unless the text names decaf, decaffeinated, a decaffeination method such as Swiss Water, EA or sugarcane, or half-caf. Guessing "caffeinated" from silence would mark the whole library as confirmed when none of it has been checked.

Coffee does not always arrive as a bag of whole beans. Cometeer flash-freezes brewed coffee into pucks, Nespresso and K-Cup are capsule systems, instant is its own thing, and plenty of bags are sold pre-ground. Record that in format, using the provided enum. A format is not a roaster and not a shop: a Cometeer box of Counter Culture coffee is Counter Culture's coffee delivered frozen, so the roaster still goes in roaster. Never put a retailer in format — a grocery store, a marketplace or any other shop that merely resold the coffee is not a format, and where a coffee was bought is not recorded at all. Return null when the text does not say what form the coffee comes in; whole beans are the ordinary case and are assumed later, so silence needs no guess from you.

Whether a bag holds one coffee or several is a separate question from how it was processed, and both can be true at once: a blend can state a washed process, and often does. Record it in composition when the text says so — "blend", "single origin" however it is spelled, or several named component lots — and note that this word usually appears in the product title or a banner above it rather than in a labelled field. Do not infer it from how many origins you listed, from the name alone, or from which section of a shop the page sits in; a coffee filed under "Blends" may well say "single origin" on its own page. Return null when the text says neither, which is common and is a real answer.

Prose describing the coffee — its story, cooperative, farm, processing or flavour — belongs in roasterDescription. Copy it from the text rather than writing your own, and condense only to remove shipping, pricing, subscription and other boilerplate that is not about the coffee itself. A site-wide tagline or mission statement is not a description of the coffee; leave it out.`;
