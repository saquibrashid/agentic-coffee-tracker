import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePasteImage } from './usePasteImage';

/**
 * A paste listener that sits on the document is easy to make greedy. These
 * tests pin the two things that keep it polite: it only reacts to an image, and
 * it stops listening the moment the page that wanted it goes away.
 */

interface ClipboardStub {
  items?: { kind: string; type: string; getAsFile: () => File | null }[];
  files?: File[];
}

function paste(clipboardData: ClipboardStub | null): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  document.dispatchEvent(event);
  return event;
}

function imageFile(name = 'screenshot.png'): File {
  return new File(['bytes'], name, { type: 'image/png' });
}

function imageClipboard(file: File): ClipboardStub {
  return {
    items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
    files: [file],
  };
}

describe('usePasteImage', () => {
  it('hands over an image pasted anywhere on the page', () => {
    const onImage = vi.fn();
    renderHook(() => usePasteImage(onImage));
    const file = imageFile();

    const event = paste(imageClipboard(file));

    expect(onImage).toHaveBeenCalledWith(file);
    // Claiming the event stops the image being pasted into a text field too.
    expect(event.defaultPrevented).toBe(true);
  });

  it('reads Safari clipboards that expose files without usable items', () => {
    const onImage = vi.fn();
    renderHook(() => usePasteImage(onImage));
    const file = imageFile();

    paste({ files: [file] });

    expect(onImage).toHaveBeenCalledWith(file);
  });

  it('leaves a text paste completely alone', () => {
    const onImage = vi.fn();
    renderHook(() => usePasteImage(onImage));

    const event = paste({ items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] });

    expect(onImage).not.toHaveBeenCalled();
    // Pasting a URL into the link field has to keep working.
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores a paste while disabled', () => {
    const onImage = vi.fn();
    renderHook(() => usePasteImage(onImage, false));

    paste(imageClipboard(imageFile()));

    expect(onImage).not.toHaveBeenCalled();
  });

  it('stops listening once the page unmounts', () => {
    const onImage = vi.fn();
    const { unmount } = renderHook(() => usePasteImage(onImage));

    unmount();
    paste(imageClipboard(imageFile()));

    expect(onImage).not.toHaveBeenCalled();
  });

  it('calls the latest handler rather than the one from first render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ handler }) => usePasteImage(handler), {
      initialProps: { handler: first },
    });

    rerender({ handler: second });
    paste(imageClipboard(imageFile()));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
