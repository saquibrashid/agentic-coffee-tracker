/**
 * The filter controls for the bean library (issue #109).
 *
 * Split out of `BeansLibraryPage` because the page was already long and this
 * is now the larger half of it.
 *
 * The controls live behind a disclosure rather than stacked above the list.
 * Six more selects always-open would push the list itself below the fold on a
 * phone, which trades one navigation problem for another — the library exists
 * so older beans are reachable. Search and sort stay outside it because they
 * are the two people reach for constantly.
 */
import { useId } from 'react';
import { ChevronDown, Search, SlidersHorizontal } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  FRESHNESS_OPTIONS,
  PROCESSES,
  RATING_OPTIONS,
  ROAST_LEVELS,
  SORT_OPTIONS,
  countActiveFilters,
  type BeanSortKey,
  type FacetOption,
  type LibraryFacets,
  type LibraryFilters,
} from '@/services/beans/library';
import type { Process, RoastLevel } from '@/types';

export interface BeanFiltersProps {
  filters: LibraryFilters;
  facets: LibraryFacets;
  onChange: <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => void;
  onReset: () => void;
}

export function BeanFilters({ filters, facets, onChange, onReset }: BeanFiltersProps) {
  const searchId = useId();
  const activeCount = countActiveFilters(filters);

  function toggleFacet(key: 'roasters' | 'origins' | 'varietals', value: string) {
    const current = filters[key];
    const next = current.some((entry) => entry.toLowerCase() === value.toLowerCase())
      ? current.filter((entry) => entry.toLowerCase() !== value.toLowerCase())
      : [...current, value];
    onChange(key, next);
  }

  return (
    <form
      className="space-y-3"
      role="search"
      aria-label="Filter beans"
      onSubmit={(e) => e.preventDefault()}
    >
      <div>
        <Label htmlFor={searchId} className="mb-1 block">
          Search
        </Label>
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            id={searchId}
            type="search"
            value={filters.search}
            onChange={(e) => onChange('search', e.target.value)}
            placeholder="Name, roaster, origin or tasting note"
            className="pr-3 pl-9"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="filter-sort" className="mb-1 block">
            Sort by
          </Label>
          <Select
            id="filter-sort"
            value={filters.sort}
            onChange={(e) => onChange('sort', e.target.value as BeanSortKey)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        {activeCount > 0 && (
          <Button type="button" variant="ghost" className="h-11" onClick={onReset}>
            Clear filters
          </Button>
        )}
      </div>

      {/*
        <details> rather than a state-driven panel: it is open/closed for free,
        keyboard operable for free, and — the part that matters — its content
        stays in the DOM, so browser find-in-page and screen-reader search can
        still reach a collapsed control.
      */}
      <details className="border-border group rounded-md border">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          Filters
          {activeCount > 0 && <Badge>{activeCount}</Badge>}
          <ChevronDown
            className="ml-auto size-4 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>

        <div className="border-border space-y-4 border-t p-3">
          <div className="flex flex-wrap gap-3">
            <div>
              <Label htmlFor="filter-roast" className="mb-1 block">
                Roast
              </Label>
              <Select
                id="filter-roast"
                value={filters.roastLevel}
                onChange={(e) => onChange('roastLevel', e.target.value as RoastLevel | 'all')}
              >
                <option value="all">All roasts</option>
                {ROAST_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="filter-process" className="mb-1 block">
                Process
              </Label>
              <Select
                id="filter-process"
                value={filters.process}
                onChange={(e) => onChange('process', e.target.value as Process | 'all')}
              >
                <option value="all">All processes</option>
                {PROCESSES.map((process) => (
                  <option key={process} value={process}>
                    {process}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="filter-rating" className="mb-1 block">
                Minimum rating
              </Label>
              <Select
                id="filter-rating"
                value={filters.minRating ?? 'any'}
                onChange={(e) =>
                  onChange('minRating', e.target.value === 'any' ? null : Number(e.target.value))
                }
              >
                <option value="any">Any rating</option>
                {RATING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="filter-freshness" className="mb-1 block">
                Freshness
              </Label>
              <Select
                id="filter-freshness"
                value={filters.roastedWithinDays ?? 'any'}
                onChange={(e) =>
                  onChange(
                    'roastedWithinDays',
                    e.target.value === 'any' ? null : Number(e.target.value),
                  )
                }
              >
                <option value="any">Any roast date</option>
                {FRESHNESS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/*
            Both of these exclude beans that lack the field entirely, which is
            the kind of rule that quietly loses data if it is only implied.
          */}
          {(filters.minRating !== null || filters.roastedWithinDays !== null) && (
            <p className="text-muted-foreground text-sm">
              {filters.minRating !== null && 'Beans you have not rated are hidden. '}
              {filters.roastedWithinDays !== null && 'Beans with no roast date are hidden.'}
            </p>
          )}

          <FacetGroup
            legend="Roaster"
            options={facets.roasters}
            selected={filters.roasters}
            onToggle={(value) => toggleFacet('roasters', value)}
          />
          <FacetGroup
            legend="Origin"
            options={facets.origins}
            selected={filters.origins}
            onToggle={(value) => toggleFacet('origins', value)}
          />
          <FacetGroup
            legend="Varietal"
            options={facets.varietals}
            selected={filters.varietals}
            onToggle={(value) => toggleFacet('varietals', value)}
          />

          <div className="flex flex-wrap gap-4">
            <CheckboxField
              label="Needs review only"
              checked={filters.needsReviewOnly}
              onChange={(e) => onChange('needsReviewOnly', e.target.checked)}
            />
            <CheckboxField
              label="Missing details only"
              checked={filters.incompleteOnly}
              onChange={(e) => onChange('incompleteOnly', e.target.checked)}
            />
            <CheckboxField
              label="Include archived"
              checked={filters.includeArchived}
              onChange={(e) => onChange('includeArchived', e.target.checked)}
            />
          </div>
        </div>
      </details>
    </form>
  );
}

/**
 * A multi-select rendered as toggle chips.
 *
 * Chips rather than a `<select multiple>`: the native control is close to
 * unusable on a phone, hides its own options, and gives no room for the counts
 * — which are the thing that tells you an option is worth picking.
 *
 * Hidden entirely when the library has nothing to offer, rather than shown
 * empty. There is no such thing as "no roasters" in a non-empty library, so an
 * empty group means the field was never filled in and an empty box would just
 * be a question the user cannot answer.
 */
function FacetGroup({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  options: FacetOption[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  // One option cannot narrow anything — every visible bean already matches it.
  if (options.length < 2) return null;

  const isSelected = (value: string) =>
    selected.some((entry) => entry.toLowerCase() === value.toLowerCase());

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = isSelected(option.value);
          return (
            <label
              key={option.value}
              className={`has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-background flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2 ${
                active
                  ? 'border-primary bg-primary text-primary-foreground font-medium'
                  : 'border-input hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <Input
                type="checkbox"
                className="sr-only"
                checked={active}
                onChange={() => onToggle(option.value)}
              />
              {option.value}{' '}
              <span className={active ? 'opacity-80' : 'text-muted-foreground'}>
                {option.count}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
