/**
 * Full bean library: browse, search, filter and sort every bean (specs/ui.md).
 *
 * Home only ever showed the six most recent beans, which made older entries
 * unreachable. This route is the answer to "where did my coffee from March go?"
 */
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Coffee, Plus, Search, Trash2, X } from 'lucide-react';

import { db } from '@/services/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { deleteBeans, summariseDeletion, type DeletionSummary } from '@/services/beans/delete';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import {
  DEFAULT_FILTERS,
  PROCESSES,
  ROAST_LEVELS,
  SORT_OPTIONS,
  filterAndSortBeans,
  hasActiveFilters,
  summariseBeans,
  type BeanSortKey,
  type BeanSummary,
  type LibraryFilters,
} from '@/services/beans/library';
import type { Process, RoastLevel } from '@/types';

const selectClass =
  'h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

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

  function set<K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

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
      <Card className="mx-auto max-w-xl text-center">
        <CardHeader>
          <Coffee className="text-primary mx-auto size-12" aria-hidden="true" />
          <CardTitle>No coffees yet</CardTitle>
          <CardDescription>Your library fills up as you log coffees.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg">
            <Link to="/add">
              <Plus aria-hidden="true" /> Add your first coffee
            </Link>
          </Button>
        </CardContent>
      </Card>
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
              Select
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
          <p className="text-sm" role="status">
            {selected.size} selected
          </p>
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
              <Trash2 aria-hidden="true" /> Remove
            </Button>
          </div>
        </div>
      )}

      {deleteError && !pendingSummary && (
        <p role="alert" className="text-destructive text-sm">
          {deleteError}
        </p>
      )}

      <form
        className="space-y-3"
        role="search"
        aria-label="Filter beans"
        onSubmit={(e) => e.preventDefault()}
      >
        <div>
          <label htmlFor="bean-search" className="mb-1 block text-sm font-medium">
            Search
          </label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              id="bean-search"
              type="search"
              value={filters.search}
              onChange={(e) => set('search', e.target.value)}
              placeholder="Name, roaster, origin or tasting note"
              className="border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:outline-hidden"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div>
            <label htmlFor="filter-roast" className="mb-1 block text-sm font-medium">
              Roast
            </label>
            <select
              id="filter-roast"
              className={selectClass}
              value={filters.roastLevel}
              onChange={(e) => set('roastLevel', e.target.value as RoastLevel | 'all')}
            >
              <option value="all">All roasts</option>
              {ROAST_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-process" className="mb-1 block text-sm font-medium">
              Process
            </label>
            <select
              id="filter-process"
              className={selectClass}
              value={filters.process}
              onChange={(e) => set('process', e.target.value as Process | 'all')}
            >
              <option value="all">All processes</option>
              {PROCESSES.map((process) => (
                <option key={process} value={process}>
                  {process}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-sort" className="mb-1 block text-sm font-medium">
              Sort by
            </label>
            <select
              id="filter-sort"
              className={selectClass}
              value={filters.sort}
              onChange={(e) => set('sort', e.target.value as BeanSortKey)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={filters.needsReviewOnly}
              onChange={(e) => set('needsReviewOnly', e.target.checked)}
            />
            Needs review only
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={filters.includeArchived}
              onChange={(e) => set('includeArchived', e.target.checked)}
            />
            Include archived
          </label>
          {hasActiveFilters(filters) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFilters(DEFAULT_FILTERS)}
            >
              Clear filters
            </Button>
          )}
        </div>
      </form>

      {visible.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No beans match your filters</CardTitle>
            <CardDescription>
              Try a different search term, or clear the filters to see all {beans.length} beans.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Clear filters
            </Button>
          </CardContent>
        </Card>
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
        {bean.thumbnailDataUrl ? (
          <img
            src={bean.thumbnailDataUrl}
            alt=""
            className="size-14 shrink-0 rounded object-cover"
          />
        ) : (
          <div
            className="bg-muted flex size-14 shrink-0 items-center justify-center rounded"
            aria-hidden="true"
          >
            <Coffee className="text-muted-foreground size-6" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base">{bean.name}</CardTitle>
          <CardDescription className="truncate">{bean.roaster}</CardDescription>
          <p className="text-muted-foreground mt-1 text-xs">
            {averageScore === null
              ? 'Not rated yet'
              : `${averageScore.toFixed(1)} ★ · ${ratingCount} ${ratingCount === 1 ? 'rating' : 'ratings'}`}
            {bean.needsReview && ' · needs review'}
            {bean.isArchived && ' · archived'}
          </p>
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
