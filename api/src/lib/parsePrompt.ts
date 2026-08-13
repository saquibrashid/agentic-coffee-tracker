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
 */
export const PARSE_SYSTEM_PROMPT = `You extract structured coffee bean metadata from text about a single coffee. The text may be OCR of a bag label, a roaster's product page, a datasheet, or details a user pasted in, so it ranges from a few label fragments to several paragraphs of prose.

Return ONLY fields present in or strongly implied by the text. Use null for anything unknown — do not invent details the text does not support. Normalize roast level and process to the provided enums. Output must match the supplied JSON schema exactly.

Prose describing the coffee — its story, cooperative, farm, processing or flavour — belongs in roasterDescription. Copy it from the text rather than writing your own, and condense only to remove shipping, pricing, subscription and other boilerplate that is not about the coffee itself.`;
