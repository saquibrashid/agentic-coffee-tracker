/**
 * Shared interaction helpers for tests.
 */
import type userEvent from '@testing-library/user-event';

type User = ReturnType<typeof userEvent.setup>;

/**
 * Put text into a field the way a person puts a URL into a field.
 *
 * `user.type()` dispatches one keystroke at a time, and every keystroke is a
 * full React render plus a jsdom event dispatch — around 22ms each in this
 * suite. For a 62-character URL that is well over a second of a test's 5000ms
 * budget spent on nothing the test is asserting about, which is what made
 * `EnrichPanel.test.tsx` time out under parallel load (#231). Pasting is one
 * event regardless of length.
 *
 * This is not only faster, it is more faithful: nobody types out a product URL,
 * and the tests using it are named for pasting. Reach for `user.type()` when
 * per-keystroke behaviour is the point — validation as you type, an input mask,
 * a debounced search — and this when the field's final value is.
 *
 * The click is what makes the paste land: `user.paste()` targets whatever has
 * focus rather than taking an element.
 */
export async function pasteInto(user: User, element: HTMLElement, text: string): Promise<void> {
  await user.click(element);
  await user.paste(text);
}
