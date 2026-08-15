/**
 * Viewing a coffee's photo at the size it was actually stored.
 *
 * Everywhere a picture appears in the app it appears small — a 160px thumbnail
 * is what a library grid and a detail header want, and it is what the bean
 * record carries so those lists can render without touching the photo table.
 * The full image is a separate row in `db.photos`, up to 1600px, and until now
 * nothing ever showed it. That is a shame for an ordinary photograph and a
 * genuine loss for a studio shot, where looking good is the entire purpose.
 *
 * The full image is fetched only when someone asks to see it. Loading it
 * eagerly would mean pulling a megabyte of blob into every card on a library
 * page to satisfy the one in fifty that gets clicked.
 *
 * The thumbnail is shown meanwhile. It is already decoded and it is the same
 * picture, so the dialog opens with content rather than a hole and sharpens in
 * place.
 */
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { usePhotoObjectUrl, type PhotoSource } from './usePhotoObjectUrl';

/**
 * Where the full-size image comes from.
 *
 * A staged photo is not in the database yet — that is what staged means — and
 * the studio re-shoot preview is the case that most needs enlarging, since
 * accepting or rejecting a generated bag from an 80px square is barely a
 * judgement at all. So a held blob is a first-class source rather than
 * something only stored photos get.
 */
export type { PhotoSource } from './usePhotoObjectUrl';

export interface PhotoLightboxProps {
  open: boolean;
  source: PhotoSource;
  /** Shown until the full image has loaded, and kept if it cannot be. */
  fallbackDataUrl: string | undefined;
  alt: string;
  onClose: () => void;
}

export function PhotoLightbox({ open, source, fallbackDataUrl, alt, onClose }: PhotoLightboxProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const fullUrl = usePhotoObjectUrl(source, open);

  useEffect(() => {
    const dialog = ref.current;
    // `showModal` is absent in jsdom, so guard rather than crash under test —
    // the same accommodation ConfirmDialog makes.
    if (!dialog || typeof dialog.showModal !== 'function') return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Click-away, bound natively rather than as an onClick prop.
  //
  // A modal `<dialog>` *is* its own backdrop as far as hit testing goes, so a
  // click landing on the element itself means the user clicked outside the
  // picture. Expressing that in JSX would put a click handler on a
  // non-interactive element, which a11y lint rightly objects to — the rule
  // exists to catch handlers that keyboard users cannot reach. Here they are
  // not stranded: Escape fires `cancel` and there is a real Close button. This
  // is a native behaviour of the element, not an interaction of its own.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;

    const onBackdropClick = (event: MouseEvent) => {
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener('click', onBackdropClick);
    return () => dialog.removeEventListener('click', onBackdropClick);
  }, [open, onClose]);

  if (!open) return null;

  const src = fullUrl ?? fallbackDataUrl;

  return (
    <dialog
      ref={ref}
      aria-label={alt}
      className="max-h-none max-w-none bg-transparent p-0 backdrop:bg-black/80"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="relative flex items-center justify-center p-2">
        {src && <img src={src} alt={alt} className="max-h-[90vh] max-w-[90vw] rounded" />}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo"
          className="absolute top-4 right-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
    </dialog>
  );
}

export interface PhotoThumbnailProps {
  /** Omitted when there is no full-size image behind the thumbnail. */
  source: PhotoSource | undefined;
  thumbnailDataUrl: string | undefined;
  alt: string;
  /** Sizing for the thumbnail itself, e.g. `size-16`. */
  className?: string;
}

/**
 * A thumbnail that opens the full photo, when there is a fuller one to open.
 *
 * Without a source this renders a plain image rather than a button. An enriched
 * picture can arrive as a thumbnail alone, and a control that blows 160px up to
 * 90vh of blur is worse than no control — it promises something the app cannot
 * deliver.
 */
export function PhotoThumbnail({ source, thumbnailDataUrl, alt, className }: PhotoThumbnailProps) {
  const [open, setOpen] = useState(false);

  if (!thumbnailDataUrl) return null;

  const image = <img src={thumbnailDataUrl} alt={alt} className={className} />;
  if (!source) return image;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${alt} — view larger`}
        className="focus-visible:ring-ring shrink-0 cursor-zoom-in rounded focus-visible:ring-2 focus-visible:outline-none"
      >
        {image}
      </button>
      <PhotoLightbox
        open={open}
        source={source}
        fallbackDataUrl={thumbnailDataUrl}
        alt={alt}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
