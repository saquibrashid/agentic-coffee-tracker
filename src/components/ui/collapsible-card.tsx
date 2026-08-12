import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A card whose body folds away.
 *
 * The bean page had every tool it owns open at once — an enrichment form, a
 * photo form and a rating form, stacked under the details people actually came
 * to read. None of them is used on a typical visit, but together they were most
 * of the page. Folding them away is what makes the page short enough to take in
 * at a glance; the summary line says what is inside so nothing has to be opened
 * to be found.
 *
 * Built on `<details>` rather than state and `hidden`, matching BeanFilters:
 * open/closed, keyboard operation and the disclosure semantics screen readers
 * announce all come for free, and — the part that is easy to lose by hand —
 * find-in-page still reaches the collapsed content.
 *
 * The `<details>` element *is* the card rather than sitting inside one. A
 * bordered box holding another bordered box reads as clutter, which is the
 * problem this is here to solve.
 */
export interface CollapsibleCardProps {
  title: string;
  /** Sits beside the title, for saying what is inside without opening it. */
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function CollapsibleCard({
  title,
  hint,
  icon,
  defaultOpen = false,
  children,
  className,
}: CollapsibleCardProps) {
  return (
    <details
      open={defaultOpen}
      className={cn('bg-card text-card-foreground group rounded-lg border shadow-sm', className)}
    >
      {/*
        `list-none` plus the webkit rule removes the native triangle in both
        engines, since the chevron on the right is doing that job. min-h-11
        keeps the whole row a comfortable tap target (WCAG 2.5.5).
      */}
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
        {icon}
        <div className="min-w-0 flex-1">
          {/*
            A real heading inside the summary: these are the page's sections,
            and heading navigation is how screen-reader users skip between
            them. HTML allows heading content in a summary for exactly this.
          */}
          <h2 className="text-base leading-tight font-semibold">{title}</h2>
          {/*
            The hint sits under the title rather than beside it. Side by side,
            the two competed for a phone's width and both lost — the title
            wrapping onto two lines while the hint truncated to an ellipsis.
          */}
          {hint && <span className="text-muted-foreground block truncate text-sm">{hint}</span>}
        </div>
        <ChevronDown
          className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t p-4 sm:p-5">{children}</div>
    </details>
  );
}
