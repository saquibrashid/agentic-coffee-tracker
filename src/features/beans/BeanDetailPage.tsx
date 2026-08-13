import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ulid } from 'ulid';
import { ArrowLeft, Camera, Check, CircleAlert, Globe, Pencil, Plus, Trash2 } from 'lucide-react';
import { db } from '@/services/db';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RoastScale } from '@/components/ui/roast-scale';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { deleteBeans, summariseDeletion, type DeletionSummary } from '@/services/beans/delete';
import { markBeanReviewed } from '@/services/beans/review';
import { deleteRating, updateRating } from '@/services/ratings/mutations';
import {
  dateInputToRatedAt,
  localDateInputValue,
  ratedAtToDateInput,
} from '@/services/ratings/date';
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
import { PhotoThumbnail } from './PhotoLightbox';
import { PhotoPanel } from './PhotoPanel';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import type { BrewType, CoffeeBean, Money, Rating } from '@/types';

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
    (bean.varietals ?? []).length === 0 &&
    (bean.tastingNotes ?? []).length === 0 &&
    bean.roasterDescription === undefined &&
    bean.elevationMeters === undefined &&
    bean.bagSizeGrams === undefined &&
    bean.pricePaid === undefined &&
    bean.purchaseDate === undefined &&
    bean.roastDate === undefined
  );
}

/** Country plus whichever narrowing detail the roaster gave, e.g.
 * "Colombia (Huila)". Farm and producer stay out: they are long, and a blend
 * would run several of them into an unreadable line. */
function formatOrigins(origins: NonNullable<CoffeeBean['origins']>): string {
  return origins
    .map((o) => {
      const place = o.region ? `${o.country} (${o.region})` : o.country;
      return o.percentage !== undefined ? `${place} ${o.percentage}%` : place;
    })
    .join(', ');
}

/** A bare date like `2026-06-01`, read as calendar text rather than an instant.
 * Parsing it as a Date would apply the local timezone and can show the day
 * before. */
function formatDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "1,800–2,000 m", or whichever end the roaster actually stated. */
function formatElevation(elevation: NonNullable<CoffeeBean['elevationMeters']>): string | null {
  const { min, max } = elevation;
  const n = (v: number) => v.toLocaleString();
  if (min !== undefined && max !== undefined) {
    return min === max ? `${n(min)} m` : `${n(min)}–${n(max)} m`;
  }
  if (min !== undefined) return `${n(min)} m and up`;
  if (max !== undefined) return `up to ${n(max)} m`;
  return null;
}

function formatMoney(money: Money): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: money.currency }).format(
      money.amount,
    );
  } catch {
    // An unrecognised currency code must not blank the whole page.
    return `${money.amount} ${money.currency}`;
  }
}

/**
 * The line beside a folded card's title, so its contents are knowable without
 * opening it — the trade that makes collapsing these panels safe.
 */
function enrichHint(bean: CoffeeBean): string {
  if (hasNoAttributes(bean)) return 'Nothing known yet';
  return bean.sourceUrl ? 'Imported' : 'Fill in what is missing';
}

/**
 * The answer to "it says this coffee needs review — review what?"
 *
 * The library badges a coffee `needsReview`, but until now that flag appeared
 * nowhere on the coffee's own page and nothing outside the capture flow could
 * clear it. Since `enrich/diff.ts` sets it on every accepted web suggestion,
 * enriching an imported coffee badged it permanently, with no way to answer.
 *
 * So this states which values are in question and offers the one action that
 * settles it. It sits directly under the details it is talking about, and
 * disappears the moment it is answered.
 */
function ReviewCard({ bean }: { bean: CoffeeBean }) {
  const [saving, setSaving] = useState(false);

  if (!bean.needsReview) return null;

  const reason = bean.sourceUrl
    ? 'These details were read off a web page rather than entered by you.'
    : 'These details were read automatically and have not been confirmed.';

  return (
    <Card className="border-primary/40 bg-accent/40">
      <CardHeader>
        <div className="flex items-start gap-3">
          <CircleAlert className="text-primary mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">Check these details</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              {reason} Correct them with <span className="font-medium">Details from the web</span>{' '}
              below, or confirm them here.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void markBeanReviewed(bean.id).finally(() => {
              setSaving(false);
            });
          }}
        >
          <Check aria-hidden="true" /> Looks right
        </Button>
      </CardContent>
    </Card>
  );
}

export function BeanDetailPage() {
  const { beanId } = useParams<{ beanId: string }>();
  const navigate = useNavigate();
  const bean = useLiveQuery(() => (beanId ? db.beans.get(beanId) : undefined), [beanId]);
  // Queried once here rather than inside the list, so the score beside the name
  // and the ratings below it can never disagree with each other mid-update.
  const ratings = useLiveQuery(async () => {
    if (!beanId) return [];
    const records = await db.ratings.where('beanId').equals(beanId).toArray();
    return records.sort((a, b) => b.ratedAt.localeCompare(a.ratedAt));
  }, [beanId]);

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
            <PhotoThumbnail
              source={bean.photoId ? { kind: 'stored', photoId: bean.photoId } : undefined}
              thumbnailDataUrl={bean.thumbnailDataUrl}
              alt={`${bean.name} bag`}
              className="size-16 shrink-0 rounded object-cover"
            />
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
              made four short facts as tall as a paragraph. Wider screens take
              more columns rather than stretching two across the whole line,
              which stranded each label a third of a screen from its value.
            */
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
              <Attribute label="Roast">
                {bean.roastLevel !== undefined && bean.roastLevel !== 'unknown' && (
                  <RoastScale level={bean.roastLevel} className="flex-wrap gap-y-1" />
                )}
              </Attribute>
              <Attribute label="Origin">
                {(bean.origins ?? []).length > 0 && formatOrigins(bean.origins ?? [])}
              </Attribute>
              <Attribute label="Process">
                {bean.process !== undefined && bean.process !== 'unknown' && bean.process}
              </Attribute>
              <Attribute label="Varietals">
                {(bean.varietals ?? []).length > 0 && (bean.varietals ?? []).join(', ')}
              </Attribute>
              <Attribute label="Elevation">
                {bean.elevationMeters !== undefined && formatElevation(bean.elevationMeters)}
              </Attribute>
              <Attribute label="Roasted">{bean.roastDate && formatDay(bean.roastDate)}</Attribute>
              <Attribute label="Purchased">
                {bean.purchaseDate && formatDay(bean.purchaseDate)}
              </Attribute>
              <Attribute label="Bag size">
                {bean.bagSizeGrams !== undefined && `${bean.bagSizeGrams} g`}
              </Attribute>
              <Attribute label="Price paid">
                {bean.pricePaid !== undefined && formatMoney(bean.pricePaid)}
              </Attribute>
            </dl>
          )}
          {/*
            Notes and the roaster's blurb sit outside the two-column grid: one
            is a set of short chips that reads better as a row, the other is
            prose that a half-width column would turn into a ladder. Both were
            stored, enriched and synced but never shown here — tasting notes
            even drive the recommendations, so a coffee's own page was the one
            place they were invisible.
          */}
          {(bean.tastingNotes ?? []).length > 0 && (
            <div className="mt-4">
              <p className="text-meta text-muted-foreground">Tasting notes</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {(bean.tastingNotes ?? []).map((note) => (
                  <li key={note}>
                    <Badge variant="secondary">{note}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {bean.roasterDescription && (
            <div className="mt-4">
              <p className="text-meta text-muted-foreground">From the roaster</p>
              <p className="mt-1 text-sm leading-relaxed">{bean.roasterDescription}</p>
            </div>
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
          <div className="mt-5 flex items-center justify-between gap-3 border-t pt-4">
            <div>
              <p className="text-sm font-medium">Manage this coffee</p>
              <p className="text-muted-foreground text-xs">
                Remove it and its attached ratings or photos.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive shrink-0"
              aria-label="Remove coffee"
              onClick={() => void requestDelete(beanIdForDelete)}
            >
              <Trash2 aria-hidden="true" /> Remove
            </Button>
          </div>
        </CardContent>
      </Card>

      <ReviewCard bean={bean} />

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
        coffeeName={bean.name}
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

  // The date distinguishes rating rows and belongs in each action's accessible
  // name. The app currently edits dates, not times, so calendar precision is
  // the same information the form exposes.
  const rated = formatDay(rating.ratedAt);

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
  const [ratedDate, setRatedDate] = useState(ratedAtToDateInput(rating.ratedAt));
  const [notes, setNotes] = useState(rating.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      await updateRating(rating.id, {
        score,
        brewType,
        ratedAt: dateInputToRatedAt(ratedDate, rating.ratedAt),
        notes,
      });
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
      <div>
        <Label htmlFor={`rating-date-${rating.id}`} className="mb-1 block">
          Date rated
        </Label>
        <Input
          id={`rating-date-${rating.id}`}
          type="date"
          value={ratedDate}
          max={localDateInputValue()}
          onChange={(e) => setRatedDate(e.target.value)}
          required
        />
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
  const [ratedDate, setRatedDate] = useState(localDateInputValue);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onAdd() {
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const rating: Rating = {
        id: ulid(),
        schemaVersion: 2,
        beanId,
        score,
        brewType,
        ratedAt: dateInputToRatedAt(ratedDate),
        createdAt: now,
        updatedAt: now,
        // Only set when non-empty; an empty string is not a note.
        ...(notes.trim() && { notes: notes.trim() }),
      };
      await db.ratings.add(rating);
      await enqueueUpsert('rating', rating.id);
      setNotes('');
      setScore(DEFAULT_SCORE);
      setRatedDate(localDateInputValue());
      // Folds the form away again: the new rating is now the top of the list
      // directly below, which is the confirmation that it worked.
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this rating.');
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
      <div>
        <Label htmlFor={`new-rating-date-${beanId}`} className="mb-1 block">
          Date rated
        </Label>
        <Input
          id={`new-rating-date-${beanId}`}
          type="date"
          value={ratedDate}
          max={localDateInputValue()}
          onChange={(e) => setRatedDate(e.target.value)}
          required
        />
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
