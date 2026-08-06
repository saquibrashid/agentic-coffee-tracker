import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
 * Bean-specific wording for the shared confirmation dialog. The counts matter
 * here: the ratings and photo are attached to the bean and go with it, which
 * the user has no other way of knowing before they commit.
 */
export function ConfirmDeleteDialog({
  open,
  summary,
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmDeleteDialogProps) {
  if (!open || !summary) return null;

  const parts = [
    `${summary.beans} ${summary.beans === 1 ? 'coffee' : 'coffees'}`,
    ...(summary.ratings > 0
      ? [`${summary.ratings} ${summary.ratings === 1 ? 'rating' : 'ratings'}`]
      : []),
    ...(summary.photos > 0
      ? [`${summary.photos} ${summary.photos === 1 ? 'photo' : 'photos'}`]
      : []),
  ];

  return (
    <ConfirmDialog
      open={open}
      title={`Remove ${summary.beans === 1 ? 'this coffee' : `these ${summary.beans} coffees`}?`}
      description={`This permanently removes ${parts.join(', ')}. It cannot be undone.`}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
