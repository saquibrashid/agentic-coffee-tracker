import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ulid } from 'ulid';
import { Pencil, Trash2 } from 'lucide-react';
import { db } from '@/services/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { deleteBeans, summariseDeletion, type DeletionSummary } from '@/services/beans/delete';
import { deleteRating, updateRating } from '@/services/ratings/mutations';
import { DEFAULT_SCORE, SCORE_CHOICES, formatOutOf, formatScore } from '@/services/ratings/scale';
import { BREW_TYPE_OPTIONS, DEFAULT_BREW_TYPE, brewLabel } from '@/services/ratings/brewTypes';
import { EnrichPanel } from './EnrichPanel';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import type { BrewType, Rating } from '@/types';

const SCORE_OPTIONS = SCORE_CHOICES;

export function BeanDetailPage() {
  const { beanId } = useParams<{ beanId: string }>();
  const navigate = useNavigate();
  const bean = useLiveQuery(() => (beanId ? db.beans.get(beanId) : undefined), [beanId]);

  const [pendingSummary, setPendingSummary] = useState<DeletionSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function requestDelete(id: string) {
    setDeleteError(null);
    try {
      setPendingSummary(await summariseDeletion([id]));
    } catch {
      setDeleteError('Could not work out what would be removed.');
    }
  }

  async function confirmDelete(id: string) {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteBeans([id]);
      setPendingSummary(null);
      // The record this page is built on is gone, so staying here would render
      // "Bean not found" — go back to the library instead.
      void navigate('/beans', { replace: true });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not remove this coffee.');
    } finally {
      setDeleting(false);
    }
  }

  if (bean === undefined) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (bean === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bean not found</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const beanIdForDelete = bean.id;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{bean.name}</CardTitle>
            <p className="text-muted-foreground text-sm">{bean.roaster}</p>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => void requestDelete(beanIdForDelete)}
          >
            <Trash2 aria-hidden="true" /> Remove coffee
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium">Attributes</h3>
            <p className="text-muted-foreground text-sm">Roast: {bean.roastLevel || '—'}</p>
            <p className="text-muted-foreground text-sm">
              Origins: {(bean.origins ?? []).map((o) => o.country).join(', ') || '—'}
            </p>
            {bean.sourceUrl && (
              <p className="text-muted-foreground text-xs break-all">
                Source:{' '}
                <a href={bean.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                  {bean.sourceUrl}
                </a>
              </p>
            )}
          </div>

          <EnrichPanel bean={bean} />

          <div>
            <h3 className="text-sm font-medium">Ratings</h3>
            <RatingsList beanId={bean.id} />
            <AddRatingForm beanId={bean.id} />
          </div>

          {deleteError && !pendingSummary && (
            <p role="alert" className="text-destructive text-sm">
              {deleteError}
            </p>
          )}
        </div>
      </CardContent>

      <ConfirmDeleteDialog
        open={pendingSummary !== null}
        summary={pendingSummary}
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete(beanIdForDelete)}
        onCancel={() => {
          setPendingSummary(null);
          setDeleteError(null);
        }}
      />
    </Card>
  );
}

function RatingsList({ beanId }: { beanId: string }) {
  const ratings = useLiveQuery(
    () => db.ratings.where('beanId').equals(beanId).reverse().toArray(),
    [beanId],
  );
  const [editingId, setEditingId] = useState<string | null>(null);

  if (ratings === undefined) return <Skeleton className="h-24" />;
  if (ratings.length === 0) return <p className="text-muted-foreground text-sm">No ratings yet.</p>;

  return (
    <ul className="space-y-2">
      {ratings.map((r) => (
        <li key={r.id} className="rounded border p-2">
          {editingId === r.id ? (
            <EditRatingForm
              rating={r}
              onDone={() => setEditingId(null)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <RatingRow rating={r} onEdit={() => setEditingId(r.id)} />
          )}
        </li>
      ))}
    </ul>
  );
}

function RatingRow({ rating, onEdit }: { rating: Rating; onEdit: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteRating(rating.id);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this rating.');
    } finally {
      setBusy(false);
    }
  }

  // The date is what tells two ratings of the same coffee apart, so it belongs
  // in the accessible name of the per-row buttons.
  const rated = new Date(rating.ratedAt).toLocaleString();

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{formatOutOf(rating.score)}</div>
          <div className="text-muted-foreground text-sm">
            {brewLabel(rating.brewType)} — {rated}
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label={`Edit rating from ${rated}`}
          >
            <Pencil aria-hidden="true" /> Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
            aria-label={`Delete rating from ${rated}`}
          >
            <Trash2 aria-hidden="true" /> Delete
          </Button>
        </div>
      </div>
      {rating.notes && <p className="mt-2 text-sm">{rating.notes}</p>}
      {error && !confirming && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        title="Remove this rating?"
        description={`This permanently removes the ${formatOutOf(rating.score)} ${brewLabel(
          rating.brewType,
        ).toLowerCase()} rating from ${rated}. It cannot be undone.`}
        busy={busy}
        error={error}
        onConfirm={() => void onDelete()}
        onCancel={() => {
          setConfirming(false);
          setError(null);
        }}
      />
    </>
  );
}

function EditRatingForm({
  rating,
  onDone,
  onCancel,
}: {
  rating: Rating;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [score, setScore] = useState(rating.score);
  const [brewType, setBrewType] = useState<BrewType>(rating.brewType);
  const [notes, setNotes] = useState(rating.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      await updateRating(rating.id, { score, brewType, notes });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this rating.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      aria-label="Edit rating"
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
    >
      <div className="flex gap-2">
        <select
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          className="rounded border p-2"
          aria-label="Score"
        >
          {SCORE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {formatScore(n)}
            </option>
          ))}
        </select>
        <select
          value={brewType}
          onChange={(e) => setBrewType(e.target.value as BrewType)}
          className="rounded border p-2"
          aria-label="Brew type"
        >
          {BREW_TYPE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full rounded border p-2"
        aria-label="Tasting notes"
        placeholder="Tasting notes (optional)"
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save rating'}
        </Button>
      </div>
    </form>
  );
}

function AddRatingForm({ beanId }: { beanId: string }) {
  const [score, setScore] = useState(DEFAULT_SCORE);
  const [brewType, setBrewType] = useState<BrewType>(DEFAULT_BREW_TYPE);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function onAdd() {
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const rating: Rating = {
        id: ulid(),
        schemaVersion: 2,
        beanId,
        score,
        brewType,
        ratedAt: now,
        createdAt: now,
        updatedAt: now,
        // Only set when non-empty; an empty string is not a note.
        ...(notes.trim() && { notes: notes.trim() }),
      };
      await db.ratings.add(rating);
      setNotes('');
      setScore(DEFAULT_SCORE);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-2">
        <select
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          className="rounded border p-2"
          aria-label="Score"
        >
          {SCORE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {formatScore(n)}
            </option>
          ))}
        </select>
        <select
          value={brewType}
          onChange={(e) => setBrewType(e.target.value as BrewType)}
          className="rounded border p-2"
          aria-label="Brew type"
        >
          {BREW_TYPE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="w-full rounded border p-2"
        aria-label="Tasting notes"
        placeholder="Tasting notes (optional)"
      />
      <div className="flex justify-end">
        <button
          onClick={onAdd}
          disabled={saving}
          className="bg-primary rounded px-3 py-2 text-white"
        >
          {saving ? 'Adding…' : 'Add rating'}
        </button>
      </div>
    </div>
  );
}
