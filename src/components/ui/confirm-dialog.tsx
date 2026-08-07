import { useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation for destructive, irreversible actions. Everything here is stored
 * locally with no server-side copy, so a delete cannot be walked back — the
 * caller is expected to spell out exactly what is about to go.
 *
 * Built on the native `<dialog>` element for focus trapping, Escape handling
 * and inertness of the page behind it, none of which is worth reimplementing.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Remove',
  busyLabel = 'Removing…',
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    // `showModal` is absent in jsdom, so guard rather than crash under test.
    if (!dialog || typeof dialog.showModal !== 'function') return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-dialog-title"
      className="border-border bg-background text-foreground max-w-md rounded-lg border p-0 backdrop:bg-black/50"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="space-y-4 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-destructive mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 id="confirm-dialog-title" className="text-base font-semibold">
              {title}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">{description}</p>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
