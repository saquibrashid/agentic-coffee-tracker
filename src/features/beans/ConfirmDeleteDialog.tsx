import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DeletionSummary } from '@/services/beans/delete';

export interface ConfirmDeleteDialogProps {
  open: boolean;
  summary: DeletionSummary | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Deleting a bean is irreversible and there is no server-side copy to recover
 * from, so the confirmation names exactly what is about to go — including the
 * ratings and photo the user may not realise are attached.
 *
 * Built on the native `<dialog>` element for focus trapping, Escape handling
 * and inertness of the page behind it, none of which is worth reimplementing.
 */
export function ConfirmDeleteDialog({
  open,
  summary,
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmDeleteDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    // `showModal` is absent in jsdom, so guard rather than crash under test.
    if (!dialog || typeof dialog.showModal !== 'function') return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open || !summary) return null;

  const parts = [
    `${summary.beans} ${summary.beans === 1 ? 'coffee' : 'coffees'}`,
    ...(summary.ratings > 0
      ? [`${summary.ratings} ${summary.ratings === 1 ? 'rating' : 'ratings'}`]
      : []),
    ...(summary.photos > 0 ? [`${summary.photos} ${summary.photos === 1 ? 'photo' : 'photos'}`] : []),
  ];

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-delete-title"
      className="max-w-md rounded-lg border border-border bg-background p-0 text-foreground backdrop:bg-black/50"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="space-y-4 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <h2 id="confirm-delete-title" className="text-base font-semibold">
              Remove {summary.beans === 1 ? 'this coffee' : `these ${summary.beans} coffees`}?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This permanently removes {parts.join(', ')}. It cannot be undone.
            </p>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? 'Removing…' : 'Remove'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
