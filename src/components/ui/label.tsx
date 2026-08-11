import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';

import { cn } from '@/lib/utils';

export type LabelProps = React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>;

/**
 * Radix's Label rather than a bare `<label>`: it suppresses the text selection
 * that a double-tap on a label otherwise produces on touch, which is a small
 * thing that reads as unfinished every time it happens.
 *
 * The dependency was already in package.json with nothing importing it. This
 * is the "wire it up" half of that decision; `react-dropdown-menu` and
 * `react-toast` were the "drop it" half.
 */
const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, LabelProps>(
  ({ className, ...props }, ref) => (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(
        'text-foreground text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  ),
);
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
