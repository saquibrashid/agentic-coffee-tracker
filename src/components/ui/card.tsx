import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * `p-6` is a lot of padding for a phone, where these cards are full-width and
 * stack. `p-4` up to `sm`, `p-5` above it, applied on the three sections
 * together so the header, body and footer stay aligned.
 */
const CARD_PADDING = 'p-4 sm:p-5';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // shadow-xs on a card that already has a border is doing nothing you
        // can see. shadow-sm plus a warm-tinted card gives the surface an edge
        // in light mode, and in dark mode the tint alone carries it — shadows
        // are close to invisible against a dark background, which is why the
        // dark --card token is a genuinely lighter brown rather than a border.
        'bg-card text-card-foreground rounded-lg border shadow-sm',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col space-y-1.5', CARD_PADDING, className)}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

// Renders a real <h2> rather than a <div>: card titles are the section headings
// of each screen, and screen-reader users navigate by heading (WCAG 2.4.6).
const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    // eslint-disable-next-line jsx-a11y/heading-has-content -- content arrives via {...props}.children
    <h2
      ref={ref}
      // Was text-2xl, which is 24px for what is usually a card label — it
      // competed with the page heading above it. The display face carries the
      // emphasis now, so the size does not have to.
      className={cn('text-lg leading-tight font-semibold', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-muted-foreground text-sm', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn(CARD_PADDING, 'pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center', CARD_PADDING, 'pt-0', className)}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
