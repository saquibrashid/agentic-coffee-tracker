import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ulid } from 'ulid';
import { ArrowLeft, Camera, Globe, Pencil, Plus, Trash2 } from 'lucide-react';
import { db } from '@/services/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RoastScale } from '@/components/ui/roast-scale';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { deleteBeans, summariseDeletion, type DeletionSummary } from '@/services/beans/delete';
import { deleteRating, updateRating } from '@/services/ratings/mutations';
import { enqueueUpsert } from '@/services/sync/outbox';
import {
  DEFAULT_SCORE,
  MAX_SCORE,
  SCORE_CHOICES,
  clampScore,
  formatOutOf,
  formatScore,
} from '@/services/ratings/scale';
import { BREW_TYPE_OPTIONS, DEFAULT_BREW_TYPE, brewLabel } from '@/services/ratings/brewTypes';
import { EnrichPanel } from './EnrichPanel';
import { PhotoPanel } from './PhotoPanel';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import type { BrewType, CoffeeBean, Rating } from '@/types';

const SCORE_OPTIONS = SCORE_CHOICES;

/**
 * The way back out of a coffee.
 *
 * The library is not in the bottom nav, so without this the only way off this
 * page is Home — which is not where most people came from.
 *
 * Going back through history returns them wherever that was, but history is
 * empty when the page was opened directly: a bookmark, a reload, or the shared
 * link that sends someone straight to a coffee. React Router marks that first
 * entry with the key `default`, which is how this tells the two apart and falls
 * back to the library rather than leaving the link doing nothing.
 */
function BackLink() {
  const navigate = useNavigate();
  const location = useLocation();
  const canGoBack = location.key !== 'default';

  if (!canGoBack) {
    return (
      <Link
        to="/beans"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> All coffees
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void navigate(-1)}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeft className="size-4" aria-hidden="true" /> Back
    </button>
  );
}

/**
 * What this coffee has scored, as the biggest thing on the page after its name.
 *
 * This is the one number people open a coffee to see, so it is set at display
 * size beside the name rather than as another line of small print. The average
 * is snapped to a legal half-step so it is written in the same vocabulary as
 * every individual rating, instead of appearing as 7.3333.
 */
function ScoreBlock({ ratings }: { ratings: Rating[] | undefined }) {
  if (ratings === undefined) return <Skeleton className="h-12 w-16" />;

  if (ratings.length === 0) {
    return (
      <div className="text-muted-foreground shrink-0 text-sm whitespace-nowrap">Not rated</div>
    );
  }

  const average = clampScore(ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length);
  return (
    <div className="shrink-0 text-right">
      <div className="text-3xl leading-none font-semibold">
        {formatScore(average)}
        <span className="text-muted-foreground text-base font-normal">/{MAX_SCORE}</span>
      </div>
      <div className="text-meta text-muted-foreground mt-1">
        {ratings.length} {ratings.length === 1 ? 'rating' : 'ratings'}
      </div>
    </div>
  );
}

/**
 * One field of the coffee.
 *
 * Renders nothing at all when the value is missing. The previous version
 * printed an em dash for every empty field, which meant a freshly imported
 * coffee showed four rows of punctuation — noise that looks like content and
 * takes up the same space. What is actually known is more useful than a fixed
 * shape, and `EmptyAttributes` covers the case where nothing is.
 */
function Attribute({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === false) return null;
  return (
    <div>
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/** True when there is nothing to say about the coffee beyond its name. */
function hasNoAttributes(bean: CoffeeBean): boolean {
  const roastKnown = bean.roastLevel !== undefined && bean.roastLevel !== 'unknown';
  const processKnown = bean.process !== undefined && bean.process !== 'unknown';
  return (
    !roastKnown &&
    !processKnown &&
    (bean.origins ?? []).length === 0 &&
    bean.roastDate === undefined
  );
}

/**
 * The line beside a folded card's title, so its contents are knowable without
 * opening it — the trade that makes collapsing these panels safe.
 */
function enrichHint(bean: CoffeeBean): string {
  if (hasNoAttributes(bean)) return 'Nothing known yet';
  return bean.sourceUrl ? 'Imported' : 'Fill in what is missing';
}

export function BeanDetailPage() {
  const { beanId } = useParams<{ beanId: string }>();
  const navigate = useNavigate();
  const bean = useLiveQuery(() => (beanId ? db.beans.get(beanId) : undefined), [beanId]);
  // Queried once here rather than inside the list, so the score beside the name
  // and the ratings below it can never disagree with each other mid-update.
  const ratings = useLiveQuery(
    () => (beanId ? db.ratings.where('beanId').equals(beanId).reverse().toArray() : []),
    [beanId],
  );

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

  /*
   * Four cards rather than one, because a single card with six headings in it
   * gives a reader no way to tell the coffee apart from the tools that change
   * it. Reading comes first and stays open; the three editing panels below are
   * folded away until asked for.
   */
  return (
    <div className="space-y-4">
      <BackLink />

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            {bean.thumbnailDataUrl && (
              <img
                src={bean.thumbnailDataUrl}
                alt={`${bean.name} bag`}
                className="size-16 shrink-0 rounded object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <CardTitle>{bean.name}</CardTitle>
              <p className="text-muted-foreground text-sm">{bean.roaster}</p>
            </div>
            <ScoreBlock ratings={ratings} />
          </div>
        </CardHeader>
        <CardContent>
          {hasNoAttributes(bean) ? (
            <p className="text-muted-foreground text-sm">
              Nothing else is known about this coffee yet. Try{' '}
              <span className="font-medium">Details from the web</span> below.
            </p>
          ) : (
            /*
              A description list rather than sentences: these are field/value
              pairs, and marking them as such is what lets a screen reader
              announce "Roast, medium-dark" instead of running the labels and
              values together into one paragraph.

              Two columns on a phone as well as on a desktop. These values are
              a few words each, so one per row left most of the line empty and
              made four short facts as tall as a paragraph.
            */
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Attribute label="Roast">
                {bean.roastLevel !== undefined && bean.roastLevel !== 'unknown' && (
                  <RoastScale level={bean.roastLevel} className="flex-wrap gap-y-1" />
                )}
              </Attribute>
              <Attribute label="Origin">
                {(bean.origins ?? []).length > 0 &&
                  (bean.origins ?? []).map((o) => o.country).join(', ')}
              </Attribute>
              <Attribute label="Process">
                {bean.process !== undefined && bean.process !== 'unknown' && bean.process}
              </Attribute>
              <Attribute label="Roasted">{bean.roastDate}</Attribute>
            </dl>
          )}
          {bean.sourceUrl && (
            <p className="text-muted-foreground mt-4 text-xs">
              <a
                href={bean.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                View on the roaster&rsquo;s site
              </a>
            </p>
          )}
        </CardContent>
      </Card>

      <RatingsCard beanId={bean.id} ratings={ratings} />

      <CollapsibleCard
        title="Details from the web"
        hint={enrichHint(bean)}
        icon={<Globe className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />}
      >
        <EnrichPanel bean={bean} />
      </CollapsibleCard>

      <CollapsibleCard
        title="Photo"
        hint={bean.thumbnailDataUrl ? 'Added' : 'None yet'}
        icon={<Camera className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />}
      >
        <PhotoPanel bean={bean} />
      </CollapsibleCard>

      {/*
        Quiet and last. Removing a coffee is rare and unrecoverable, so it gets
        the least emphasis on the page rather than the most — it was previously
        a filled red button, which drew the eye straight to the one control
        nobody opens this page to use. The confirmation dialog is what actually
        protects the record.
      */}
      <div className="flex justify-end pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => void requestDelete(beanIdForDelete)}
        >
          <Trash2 aria-hidden="true" /> Remove coffee
        </Button>
      </div>

      {deleteError && !pendingSummary && (
        <p role="alert" className="text-destructive text-sm">
          {deleteError}
        </p>
      )}

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
    </div>
  );
}

/**
 * The rating history, and the form that adds to it.
 *
 * The history is always visible — it is half the reason the page exists. The
 * form is not: it was permanently open below the list, roughly a third of the
 * page's height spent on two dropdowns and a textarea that are used once per
 * visit at most. Behind a button it costs one tap and nothing at all when
 * unused.
 */
function RatingsCard({ beanId, ratings }: { beanId: string; ratings: Rating[] | undefined }) {
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Ratings</CardTitle>
        {!adding && (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" /> Add rating
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {adding && (
          <div className="mb-4">
            <h3 className="text-sm font-medium">Add a rating</h3>
            <AddRatingForm beanId={beanId} onDone={() => setAdding(false)} />
          </div>
        )}
        <RatingsList ratings={ratings} />
      </CardContent>
    </Card>
  );
}

function RatingsList({ ratings }: { ratings: Rating[] | undefined }) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (ratings === undefined) return <Skeleton className="h-24" />;
  if (ratings.length === 0) return <p className="text-muted-foreground text-sm">No ratings yet.</p>;

  /*
   * Divided rows rather than a bordered box per rating. Inside a card, a list
   * of boxes reads as a stack of separate things competing with their
   * container; a hairline between rows says "these belong together" with a
   * fraction of the ink.
   */
  return (
    <ul className="divide-y">
      {ratings.map((r) => (
        <li key={r.id} className="py-3 first:pt-0 last:pb-0">
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
  // in the accessible name of the per-row buttons — at full precision, since
  // two cups of the same coffee on one day are not unusual.
  const rated = new Date(rating.ratedAt).toLocaleString();
  // On screen the seconds are noise: they wrapped the line and said nothing.
  const ratedShort = new Date(rating.ratedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{formatOutOf(rating.score)}</div>
          <div className="text-muted-foreground text-sm">
            {brewLabel(rating.brewType)} — {ratedShort}
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
        <Select value={score} onChange={(e) => setScore(Number(e.target.value))} aria-label="Score">
          {SCORE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {formatScore(n)}
            </option>
          ))}
        </Select>
        <Select
          value={brewType}
          onChange={(e) => setBrewType(e.target.value as BrewType)}
          aria-label="Brew type"
        >
          {BREW_TYPE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
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

function AddRatingForm({ beanId, onDone }: { beanId: string; onDone: () => void }) {
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
      await enqueueUpsert('rating', rating.id);
      setNotes('');
      setScore(DEFAULT_SCORE);
      // Folds the form away again: the new rating is now the top of the list
      // directly below, which is the confirmation that it worked.
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      aria-label="Add rating"
      className="mt-2 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onAdd();
      }}
    >
      <div className="flex gap-2">
        <Select value={score} onChange={(e) => setScore(Number(e.target.value))} aria-label="Score">
          {SCORE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {formatScore(n)}
            </option>
          ))}
        </Select>
        <Select
          value={brewType}
          onChange={(e) => setBrewType(e.target.value as BrewType)}
          aria-label="Brew type"
        >
          {BREW_TYPE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        aria-label="Tasting notes"
        placeholder="Tasting notes (optional)"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        {/*
          Was a bare <button> with hand-written classes, which meant it alone
          ignored the theme — the one control on the page that did not match
          the rest in dark mode.
        */}
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Adding…' : 'Add rating'}
        </Button>
      </div>
    </form>
  );
}
