import { useState, type FormEvent } from 'react';
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
import { CAFFEINE_LABELS, caffeineOf } from '@/services/beans/caffeine';
import { formatLabel, hasNotableFormat } from '@/services/beans/format';
import { COMPOSITIONS, COMPOSITION_LABELS, compositionOf } from '@/services/beans/composition';
import { formatOriginList } from '@/services/beans/origins';
import { CAFFEINE_LEVELS, PROCESSES } from '@/services/beans/library';
import { markBeanReviewed } from '@/services/beans/review';
import { isFieldUnpublished } from '@/services/enrich/completeness';
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
import type {
  BrewType,
  CaffeineLevel,
  CoffeeBean,
  Composition,
  Money,
  Process,
  Rating,
} from '@/types';

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

/**
 * The one bean attribute the user can change by hand.
 *
 * Everything else on this card is read-only and corrected through a web lookup,
 * which is the right default for facts a roaster publishes. Caffeine is not one
 * of those facts: it is assumed rather than read whenever a bag does not say
 * "decaf" on it, so there has to be somewhere to say otherwise, and a lookup
 * cannot be that place — it would have to find evidence the bag never printed.
 *
 * Saving on change rather than behind an edit/save pair. There is one value, it
 * comes from a closed list, and choosing it *is* the intent; a confirm step
 * would only add a way to lose the change.
 */
function CaffeineAttribute({ bean }: { bean: CoffeeBean }) {
  const [saving, setSaving] = useState(false);

  async function onChange(level: CaffeineLevel) {
    setSaving(true);
    try {
      await db.beans.update(bean.id, { caffeine: level, updatedAt: new Date().toISOString() });
      await enqueueUpsert('bean', bean.id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <dt className="text-meta text-muted-foreground">
        <Label htmlFor="bean-caffeine">Caffeine</Label>
      </dt>
      <dd className="mt-0.5 text-sm">
        <Select
          id="bean-caffeine"
          value={caffeineOf(bean)}
          disabled={saving}
          onChange={(e) => void onChange(e.target.value as CaffeineLevel)}
        >
          {CAFFEINE_LEVELS.map((level) => (
            <option key={level} value={level}>
              {CAFFEINE_LABELS[level]}
            </option>
          ))}
        </Select>
      </dd>
    </div>
  );
}

/**
 * Composition, as a control rather than a read-out.
 *
 * The same shape as `CaffeineAttribute`, and editable for the same reason: the
 * roaster's page frequently says neither "blend" nor "single origin", and the
 * user usually knows perfectly well which it is. Unlike process there is no
 * unpublished mark to clear, because composition is not a field the app ever
 * nags about — see `ENRICHABLE_FIELDS` in `completeness.ts`.
 */
function CompositionAttribute({ bean }: { bean: CoffeeBean }) {
  const [saving, setSaving] = useState(false);

  async function onChange(composition: Composition) {
    setSaving(true);
    try {
      await db.beans.update(bean.id, { composition, updatedAt: new Date().toISOString() });
      await enqueueUpsert('bean', bean.id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <dt className="text-meta text-muted-foreground">
        <Label htmlFor="bean-composition">Composition</Label>
      </dt>
      <dd className="mt-0.5 text-sm">
        <Select
          id="bean-composition"
          value={compositionOf(bean)}
          disabled={saving}
          onChange={(e) => void onChange(e.target.value as Composition)}
        >
          {COMPOSITIONS.map((value) => (
            <option key={value} value={value}>
              {COMPOSITION_LABELS[value]}
            </option>
          ))}
        </Select>
      </dd>
    </div>
  );
}

/**
 * Process, as a control rather than a read-out.
 *
 * The same shape as `CaffeineAttribute` above and for the same reason: this is
 * the one field a lookup routinely cannot supply, because a blend does not have
 * a single process and its page says so by saying nothing (#309). Leaving the
 * user nothing but a blank cell meant a value they knew perfectly well — off
 * the bag, or from the roaster's own description — had nowhere to go.
 *
 * `unknown` is offered as an ordinary option so the control can be undone. It
 * is the schema's blank, not a value, and `isFieldMissing` reads it as absent.
 */
function ProcessAttribute({ bean }: { bean: CoffeeBean }) {
  const [saving, setSaving] = useState(false);
  const unpublished = isFieldUnpublished(bean, 'process');

  async function onChange(process: Process) {
    setSaving(true);
    try {
      // Typing a value answers the question the mark was standing in for, so
      // the mark goes with it -- otherwise clearing the field later would leave
      // the coffee silently exempt from a lookup that could now succeed.
      await db.beans.update(bean.id, (draft) => {
        draft.process = process;
        draft.updatedAt = new Date().toISOString();
        const rest = (draft.unpublishedFields ?? []).filter((f) => f !== 'process');
        if (rest.length > 0) draft.unpublishedFields = rest;
        else {
          delete draft.unpublishedFields;
          delete draft.unpublishedFrom;
        }
      });
      await enqueueUpsert('bean', bean.id);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <dt className="text-meta text-muted-foreground">
        <Label htmlFor="bean-process">Process</Label>
      </dt>
      <dd className="mt-0.5 text-sm">
        <Select
          id="bean-process"
          value={bean.process ?? 'unknown'}
          disabled={saving}
          onChange={(e) => void onChange(e.target.value as Process)}
        >
          {PROCESSES.map((process) => (
            <option key={process} value={process}>
              {process === 'unknown' ? 'Not set' : process}
            </option>
          ))}
        </Select>
        {unpublished && (
          <p className="text-muted-foreground mt-1 text-xs">
            The page we found didn&apos;t list one — blends often don&apos;t have a single process.
          </p>
        )}
      </dd>
    </div>
  );
}

/** The host, as something a reader can recognise at a glance. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True for an address a browser can actually open. */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Where this coffee can be read about, which can be two different places.
 *
 * A Cometeer box and Counter Culture's own bag are the same beans sold by
 * different people, and enrichment finds the roaster while the user bought the
 * box. Showing only one link meant showing whichever wrote last, so a coffee
 * added from Cometeer ended up linking to a bag the user never had.
 *
 * Both are named by host rather than by a fixed label. The app cannot tell a
 * roaster's own storefront from a reseller's, and "View on the roaster's site"
 * was a claim it could not keep; `cometeer.com` is one it can.
 *
 * The vendor address is editable because capture cannot always know it. Only
 * the link path has a URL to record: photograph a Cometeer box and the app
 * reads the label, searches for the roaster, and lands on Counter Culture's
 * page — correct as provenance, and leaving no trace of where the coffee
 * actually came from. That is not a capture bug to fix, it is a fact the user
 * holds and the app has no way to derive, so there has to be somewhere to say
 * it. Enrichment still never writes this field; only the user does.
 */
function SourceLinks({ bean }: { bean: CoffeeBean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const vendor = bean.vendorUrl;
  const source = bean.sourceUrl;
  // One address written twice is still one place, and the common case -- a
  // coffee added straight from its roaster's page -- must not sprout a
  // duplicate link.
  const links = [
    ...(vendor ? [{ url: vendor, label: 'Where you bought it' }] : []),
    ...(source && source !== vendor ? [{ url: source, label: 'Where the details came from' }] : []),
  ];

  function startEditing() {
    setValue(vendor ?? '');
    setError(null);
    setEditing(true);
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed && !isHttpUrl(trimmed)) {
      setError('Enter a full web address, starting with http:// or https://.');
      return;
    }
    setSaving(true);
    try {
      // The callback form so that clearing the box *removes* the field. An
      // object spec can only assign, and assigning `undefined` would store a
      // key that is present and empty -- which sync would then copy to every
      // other device as a deliberate value.
      await db.beans.update(bean.id, (draft) => {
        if (trimmed) draft.vendorUrl = trimmed;
        else delete draft.vendorUrl;
        draft.updatedAt = new Date().toISOString();
      });
      await enqueueUpsert('bean', bean.id);
      setEditing(false);
      setError(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4">
      {links.length > 0 && (
        <ul className="text-muted-foreground space-y-1 text-xs">
          {links.map(({ url, label }) => (
            <li key={url}>
              <span>{label}: </span>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                {hostOf(url) ?? url}
              </a>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <form onSubmit={(e) => void onSave(e)} className="mt-2 space-y-2" noValidate>
          {/* `noValidate` so the one message the user sees is ours. The input is
              still `type="url"` for the keyboard it summons on a phone, but the
              browser's own bubble would fire first and say something different,
              and it would also disagree with us: it accepts `javascript:` and
              we do not. */}
          <Label htmlFor="bean-vendor-url" className="text-meta text-muted-foreground">
            Where you bought it
          </Label>
          <Input
            id="bean-vendor-url"
            type="url"
            inputMode="url"
            placeholder="https://cometeer.com/products/..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby={error ? 'bean-vendor-url-error' : undefined}
          />
          {error && (
            <p id="bean-vendor-url-error" role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            The shop or box you bought this from, if that is not the roaster&apos;s own page. Leave
            it empty to remove it.
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-1 h-auto px-0 text-xs"
          onClick={startEditing}
        >
          {vendor ? 'Change where you bought this' : 'Add where you bought this'}
        </Button>
      )}
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

/**
 * Says out loud that a web lookup is already running for this coffee.
 *
 * Saving a coffee with gaps in it queues a lookup — `ConfirmForm` has done this
 * since single-add stopped being the worse path for metadata — but nothing ever
 * said so. The user landed here, saw the same blanks they had just failed to
 * fill, and had no way to tell the difference between "nothing is happening"
 * and "it is being looked up right now". Reported as exactly that: not knowing
 * the lookup could be done at all, when in fact it was already under way.
 *
 * So this is a report, not a button. Offering "look this up" here would be
 * offering to do a second time what is already queued, and pressing it is how
 * you end up with duplicate work and a slower answer.
 *
 * It disappears on its own, because the queue deletes the task when it
 * finishes and this is a live query over that table — the same fact drives the
 * card and the work, so the card cannot outlive what it describes.
 */
function LookupPendingCard({ beanId }: { beanId: string }) {
  const queued = useLiveQuery(
    () => db.pendingAiTasks.where('beanId').equals(beanId).toArray(),
    [beanId],
  );

  if (!queued?.some((task) => task.type === 'web-enrich')) return null;

  return (
    <Card className="border-primary/40 bg-accent/40">
      <CardHeader>
        <div className="flex items-start gap-3">
          <Globe className="text-primary mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">Filling in what is missing</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              This coffee was saved with some details blank, so the roaster&rsquo;s page is being
              looked up for them. It runs on its own — you can carry on, or leave the app entirely,
              and the details will appear here when it finishes. If you are offline it waits until
              you are back.
            </p>
          </div>
        </div>
      </CardHeader>
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
              <p className="text-muted-foreground text-sm">
                {bean.roaster}
                {/* Packaging, not a tasting attribute, so it sits with the
                    roaster rather than in the grid below. Cometeer flash-freezes
                    other roasters' coffee, so the box is still Counter Culture's
                    -- the roaster stays, and this says what form it came in.
                    Suppressed for whole bean, which is nearly every coffee and
                    so distinguishes nothing. */}
                {hasNotableFormat(bean) && <span> · {formatLabel(bean)}</span>}
              </p>
            </div>
            <ScoreBlock ratings={ratings} />
          </div>
        </CardHeader>
        <CardContent>
          {hasNoAttributes(bean) && (
            <p className="text-muted-foreground mb-3 text-sm">
              Nothing else is known about this coffee yet. Try{' '}
              <span className="font-medium">Details from the web</span> below.
            </p>
          )}
          {
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

              Rendered even when nothing is known, where it collapses to the one
              caffeine control. That control is the only way to correct a coffee
              the app assumed was caffeinated, so hiding it behind "we know
              nothing about this bean" would put it out of reach exactly where a
              sparse decaf needs it.
            */
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
              <Attribute label="Roast">
                {bean.roastLevel !== undefined && bean.roastLevel !== 'unknown' && (
                  <RoastScale level={bean.roastLevel} className="flex-wrap gap-y-1" />
                )}
              </Attribute>
              <Attribute label="Origin">
                {(bean.origins ?? []).length > 0 && formatOriginList(bean.origins)}
              </Attribute>
              <ProcessAttribute bean={bean} />
              <CompositionAttribute bean={bean} />
              <CaffeineAttribute bean={bean} />
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
          }
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
          <SourceLinks bean={bean} />
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

      <LookupPendingCard beanId={bean.id} />

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
