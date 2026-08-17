/**
 * Accept an image pasted anywhere on the page.
 *
 * The listener sits on the document rather than on a drop target because the
 * gesture people already know is "screenshot, then Ctrl+V" — they do not first
 * look for a box to aim at. A paste carrying no image is left entirely alone,
 * so typing a URL into a field and pasting text still behaves normally.
 *
 * `clipboardData` on the event is used deliberately in preference to
 * `navigator.clipboard.read()`: the paste gesture is its own permission, so
 * reading it costs the user no prompt, and nothing is read unless they ask.
 */
import { useEffect, useRef } from 'react';

function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  // Safari populates `files` without always exposing usable `items`.
  for (const file of Array.from(data.files ?? [])) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}

export function usePasteImage(onImage: (file: File) => void, enabled = true): void {
  // The handler closes over page state that changes on every render; holding it
  // in a ref keeps one listener registered instead of churning per keystroke.
  const handlerRef = useRef(onImage);
  useEffect(() => {
    handlerRef.current = onImage;
  }, [onImage]);

  useEffect(() => {
    if (!enabled) return;
    function onPaste(event: ClipboardEvent) {
      const file = imageFromClipboard(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      handlerRef.current(file);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [enabled]);
}
