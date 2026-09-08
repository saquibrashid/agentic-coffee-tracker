import { describe, expect, it } from 'vitest';
import { PARSE_SYSTEM_PROMPT } from './parsePrompt.js';

/*
 * A user pasted a roaster's About paragraph for a Konga, Ethiopia and got back
 * nothing but the roaster's name — `roasterDescription` came back null.
 *
 * The prompt was the cause: it described its input as "OCR text of a coffee
 * bag" and told the model to use null for anything not strongly implied. Bag
 * labels do not carry a "description" field, so several paragraphs of prose had
 * nowhere to go. These pin the two things that fixed it.
 */
describe('PARSE_SYSTEM_PROMPT', () => {
  it('does not claim every input is a bag label', () => {
    // `/api/parse` also receives scraped product pages, PDFs and pasted text.
    expect(PARSE_SYSTEM_PROMPT).toMatch(/product page|pasted/i);
    expect(PARSE_SYSTEM_PROMPT).not.toMatch(/from OCR text of a coffee bag/i);
  });

  it('sends prose about the coffee to roasterDescription', () => {
    expect(PARSE_SYSTEM_PROMPT).toMatch(/roasterDescription/);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/prose/i);
  });

  it('still refuses to invent what the text does not say', () => {
    // The looser framing must not become licence to fill fields from nothing:
    // an invented origin is worse than a missing one.
    expect(PARSE_SYSTEM_PROMPT).toMatch(/null for anything unknown/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/do not invent/i);
  });

  it('copies the roaster rather than writing new marketing copy', () => {
    expect(PARSE_SYSTEM_PROMPT).toMatch(/copy it from the text/i);
  });

  /*
   * The opposite failure to the one above. A Cometeer "build your own box" page
   * describes forty coffees; the prompt's first sentence promised one, so the
   * model merged them into a coffee that does not exist. Nothing structural in
   * the page reveals this, so the model is the only thing in the chain that can
   * notice — and it had been told not to.
   */
  it('allows the model to say the text is not about one coffee', () => {
    expect(PARSE_SYSTEM_PROMPT).toMatch(/not about one coffee|many different coffees/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/listing page|category page/i);
  });

  it('asks for nothing rather than a merge', () => {
    expect(PARSE_SYSTEM_PROMPT).toMatch(/rather than combining several coffees/i);
    expect(PARSE_SYSTEM_PROMPT).toMatch(/never assemble a coffee from parts of several/i);
  });

  it('keeps a site-wide tagline out of the coffee description', () => {
    expect(PARSE_SYSTEM_PROMPT).toMatch(/tagline|mission statement/i);
  });
});
