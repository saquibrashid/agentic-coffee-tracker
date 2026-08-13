/**
 * Full bean library: browse, search, filter and sort every bean (specs/ui.md).
 *
 * Home only ever showed the six most recent beans, which made older entries
 * unreachable. This route is the answer to "where did my coffee from March go?"
 */
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Coffee, Plus, SearchX, Trash2, X } from 'lucide-react';

import { db } from '@/services/db';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { RoastScale } from '@/components/ui/roast-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { deleteBeans, summariseDeletion, type DeletionSummary } from '@/services/beans/delete';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { BeanFilters } from './BeanFilters';
import { BeanThumbnail } from './BeanThumbnail';
import {
  DEFAULT_FILTERS,
  collectFacets,
  filterAndSortBeans,
  summariseBeans,
  type BeanSummary,
  type LibraryFilters,
} from '@/services/beans/library';

export function BeansLibraryPage() {
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingSummary, setPendingSummary] = useState<DeletionSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const beans = useLiveQuery(() => db.beans.toArray(), []);
  const ratings = useLiveQuery(() => db.ratings.toArray(), []);

  const visible = useMemo(() => {
    if (!beans || !ratings) return null;
    return filterAndSortBeans(summariseBeans(beans, ratings), filters);
  }, [beans, ratings, filters]);

  // Options come from the beans in scope rather than a constant, so the
  // controls can only ever offer values that match something. Recomputed with
  // `includeArchived` because an archived-only roaster must not be offered
  // while archived beans are hidden.
  const facets = useMemo(
    () => collectFacets(beans ?? [], filters.includeArchived),
    [beans, filters.includeArchived],
  );

  const set = useCallback(<K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function exitSelection() {
    setSelecting(false);
    setSelected(new Set());
  }

  async function requestDelete() {
    setDeleteError(null);
    setStatus(null);
    try {
      setPendingSummary(await summariseDeletion([...selected]));
    } catch {
      setDeleteError('Could not work out what would be removed.');
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const removed = await deleteBeans([...selected]);
      setPendingSummary(null);
      exitSelection();
      setStatus(`Removed ${removed.beans} ${removed.beans === 1 ? 'coffee' : 'coffees'}.`);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not remove those coffees.');
    } finally {
      setDeleting(false);
    }
  }

  if (beans === undefined || ratings === undefined || visible === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  // No beans at all is a different problem from no beans matching, and needs a
  // different call to action.
  if (beans.length === 0) {
    return (
      <EmptyState
        icon={<Coffee />}
        title="Your library is empty"
        description="Every coffee you log lands here, with its roaster, origin and how you rated it."
        action={
          <Button asChild size="lg">
            <Link to="/add">
              <Plus aria-hidden="true" /> Add your first coffee
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Bean library</h2>
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground text-sm" role="status">
            {visible.length} of {beans.length} {beans.length === 1 ? 'bean' : 'beans'}
          </p>
          {selecting ? (
            <Button type="button" variant="ghost" size="sm" onClick={exitSelection}>
              <X aria-hidden="true" /> Done
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setSelecting(true)}>
              Manage
            </Button>
          )}
        </div>
      </div>

      {status && (
        <p role="status" className="text-muted-foreground text-sm">
          {status}
        </p>
      )}

      {selecting && (
        <div className="border-border bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Select coffees to remove</p>
            <p className="text-muted-foreground text-xs" role="status">
              {selected.size} selected
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={visible.length === 0}
              onClick={() =>
                setSelected((prev) =>
                  prev.size === visible.length ? new Set() : new Set(visible.map((s) => s.bean.id)),
                )
              }
            >
              {selected.size === visible.length && visible.length > 0
                ? 'Clear selection'
                : 'Select all shown'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={selected.size === 0}
              onClick={() => void requestDelete()}
            >
              <Trash2 aria-hidden="true" /> Remove selected
            </Button>
          </div>
        </div>
      )}

      {deleteError && !pendingSummary && (
        <p role="alert" className="text-destructive text-sm">
          {deleteError}
        </p>
      )}

      <BeanFilters filters={filters} facets={facets} onChange={set} onReset={resetFilters} />

      {visible.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="No beans match your filters"
          description={`All ${beans.length} of your coffees are still here — the current filters just hide them.`}
          action={
            <Button variant="outline" onClick={resetFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <ul aria-label="Beans" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((summary) => (
            <li key={summary.bean.id}>
              <BeanRow
                summary={summary}
                selecting={selecting}
                selected={selected.has(summary.bean.id)}
                onToggle={toggleSelected}
              />
            </li>
          ))}
        </ul>
      )}

      <ConfirmDeleteDialog
        open={pendingSummary !== null}
        summary={pendingSummary}
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setPendingSummary(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
}

function BeanRow({
  summary,
  selecting,
  selected,
  onToggle,
}: {
  summary: BeanSummary;
  selecting: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const { bean, ratingCount, averageScore } = summary;

  const body = (
    <Card
      className={`h-full transition ${selected ? 'ring-destructive ring-2' : 'hover:shadow-md'}`}
    >
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        {selecting && (
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0"
            checked={selected}
            // The surrounding label drives the toggle; this keeps React from
            // warning about a controlled input with no handler.
            onChange={() => onToggle(bean.id)}
            aria-label={`Select ${bean.name}`}
          />
        )}
        <BeanThumbnail dataUrl={bean.thumbnailDataUrl} />
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base">{bean.name}</CardTitle>
          <CardDescription className="truncate">{bean.roaster}</CardDescription>
          <RoastScale level={bean.roastLevel} compact className="mt-1.5" />
          <p className="text-muted-foreground mt-1 text-xs">
            {averageScore === null
              ? 'Not rated yet'
              : `${averageScore.toFixed(1)} ★ · ${ratingCount} ${ratingCount === 1 ? 'rating' : 'ratings'}`}
          </p>
          {/*
            Status was appended to the rating line as " · needs review", where
            it read as more of the same sentence. As badges these are scannable
            down a column of twenty cards, which is the only way they are ever
            actually read.
          */}
          {(bean.needsReview || bean.isArchived) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {bean.needsReview && <Badge variant="secondary">Needs review</Badge>}
              {bean.isArchived && <Badge variant="muted">Archived</Badge>}
            </div>
          )}
        </div>
      </CardHeader>
    </Card>
  );

  // While selecting, tapping a row must pick it rather than navigate away —
  // otherwise choosing several coffees to remove means a trip back per row.
  if (selecting) {
    return <label className="block cursor-pointer">{body}</label>;
  }

  return (
    <Link to={`/beans/${bean.id}`} className="block">
      {body}
    </Link>
  );
}
