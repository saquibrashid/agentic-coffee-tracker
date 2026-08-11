import * as React from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** Usually a lucide icon. Rendered decoratively — the heading carries meaning. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The way out. An empty state without one is a dead end. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * The screen we show when there is nothing to show.
 *
 * Every empty state in the app was a differently-shaped one-off, which is why
 * they read as an oversight rather than a designed moment. This gives them one
 * shape: a mark, a sentence in the display face, a line of explanation, and a
 * way out.
 *
 * The mark sits on a tinted disc rather than floating: a lone thin-stroke icon
 * on a flat background is the single most generic thing an interface can do,
 * and the disc costs one element to fix it.
 */
function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'mx-auto flex max-w-md flex-col items-center px-6 py-12 text-center',
        className,
      )}
    >
      {icon !== undefined && (
        <div
          className="bg-accent text-accent-foreground mb-5 flex size-16 items-center justify-center rounded-full [&_svg]:size-7"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <p className="font-display text-xl font-semibold text-balance">{title}</p>
      {description !== undefined && (
        <p className="text-muted-foreground mt-2 text-sm text-pretty">{description}</p>
      )}
      {action !== undefined && <div className="mt-6">{action}</div>}
    </div>
  );
}

export { EmptyState };
