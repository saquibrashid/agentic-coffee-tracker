/**
 * Full bean library: browse, search, filter and sort every bean (specs/ui.md).
 *
 * Home only ever showed the six most recent beans, which made older entries
 * unreachable. This route is the answer to "where did my coffee from March go?"
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Coffee, Plus, Search } from 'lucide-react';

import { db } from '@/services/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
  'h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function BeansLibraryPage() {
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);

  const beans = useLiveQuery(() => db.beans.toArray(), []);
  const ratings = useLiveQuery(() => db.ratings.toArray(), []);

  const visible = useMemo(() => {
    if (!beans || !ratings) return null;
    return filterAndSortBeans(summariseBeans(beans, ratings), filters);
  }, [beans, ratings, filters]);

  function set<K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
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
          <Coffee className="mx-auto size-12 text-primary" aria-hidden="true" />
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
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Bean library</h2>
        <p className="text-sm text-muted-foreground" role="status">
          {visible.length} of {beans.length} {beans.length === 1 ? 'bean' : 'beans'}
        </p>
      </div>

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
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id="bean-search"
              type="search"
              value={filters.search}
              onChange={(e) => set('search', e.target.value)}
              placeholder="Name, roaster, origin or tasting note"
              className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
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
              <BeanRow summary={summary} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BeanRow({ summary }: { summary: BeanSummary }) {
  const { bean, ratingCount, averageScore } = summary;
  return (
    <Link to={`/beans/${bean.id}`} className="block">
      <Card className="h-full transition hover:shadow-md">
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          {bean.thumbnailDataUrl ? (
            <img
              src={bean.thumbnailDataUrl}
              alt=""
              className="size-14 shrink-0 rounded object-cover"
            />
          ) : (
            <div
              className="flex size-14 shrink-0 items-center justify-center rounded bg-muted"
              aria-hidden="true"
            >
              <Coffee className="size-6 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">{bean.name}</CardTitle>
            <CardDescription className="truncate">{bean.roaster}</CardDescription>
            <p className="mt-1 text-xs text-muted-foreground">
              {averageScore === null
                ? 'Not rated yet'
                : `${averageScore.toFixed(1)} ★ · ${ratingCount} ${ratingCount === 1 ? 'rating' : 'ratings'}`}
              {bean.needsReview && ' · needs review'}
              {bean.isArchived && ' · archived'}
            </p>
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}
