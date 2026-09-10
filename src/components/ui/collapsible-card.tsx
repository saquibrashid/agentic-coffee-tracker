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
/**
 * The rank the next `CollapsibleCard` gives its title.
 *
 * A card under a page title is an `h2`. The Settings page puts its sections
 * under group headings, so there the group is the `h2` and each section must
 * drop to `h3` — a section outranking the heading it sits beneath inverts the
 * outline a screen reader announces.
 *
 * Context rather than a prop because the panels in between do not own this
 * decision and should not have to forward it. Where a card is nested is the
 * page's business, not the panel's.
 */
const HeadingLevelContext = React.createContext<'h2' | 'h3'>('h2');

export function CollapsibleCardHeadingLevel({
  level,
  children,
}: {
  level: 'h2' | 'h3';
  children: React.ReactNode;
}) {
  return <HeadingLevelContext.Provider value={level}>{children}</HeadingLevelContext.Provider>;
}

export interface CollapsibleCardProps {
  title: string;
  /** Sits beside the title, for saying what is inside without opening it. */
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  /**
   * Marks the row as wanting the user, while it stays shut.
   *
   * A dot rather than a count, which is what was asked for: the hint line
   * underneath already carries the number, so a badge would say it twice.
   *
   * The string is not decoration. Colour alone cannot carry meaning (WCAG
   * 1.4.1), and the dot is invisible to a screen reader, so whatever is passed
   * here is announced as part of the row instead. Pass what is actually wrong
   * — "3 coffees need attention" — not the word "attention".
   */
  attention?: string;
  /**
   * The rank of the title inside the summary.
   *
   * Defaults to whatever `CollapsibleCardHeadingLevel` supplies, which is `h2`
   * outside any group. Set it directly only to override that.
   */
  headingLevel?: 'h2' | 'h3';
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function CollapsibleCard({
  title,
  hint,
  icon,
  attention,
  headingLevel,
  defaultOpen = false,
  children,
  className,
}: CollapsibleCardProps) {
  const contextLevel = React.useContext(HeadingLevelContext);
  const level = headingLevel ?? contextLevel;
  // Written out rather than rendered from a variable tag name: assigning the
  // tag to a capitalised local makes React treat it as a component created
  // during render, which remounts the subtree on every pass.
  const headingClassName = 'text-base leading-tight font-semibold';
  const headingContent = (
    <>
      {title}
      {attention && <span className="sr-only"> — {attention}</span>}
    </>
  );
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
          {level === 'h3' ? (
            <h3 className={headingClassName}>{headingContent}</h3>
          ) : (
            <h2 className={headingClassName}>{headingContent}</h2>
          )}
          {/*
            The hint sits under the title rather than beside it. Side by side,
            the two competed for a phone's width and both lost — the title
            wrapping onto two lines while the hint truncated to an ellipsis.
          */}
          {hint && <span className="text-muted-foreground block truncate text-sm">{hint}</span>}
        </div>
        {/*
          Sits before the chevron so the eye meets it on the way in, and is
          `shrink-0` because a row whose title wraps must not squash it away.
        */}
        {attention && (
          <span data-testid="attention-dot" className="bg-primary size-2 shrink-0 rounded-full" />
        )}
        <ChevronDown
          className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t p-4 sm:p-5">{children}</div>
    </details>
  );
}
