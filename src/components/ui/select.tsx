import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { controlBase, controlHeight } from './control';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * A native `<select>`, deliberately.
 *
 * Radix's Select is a nicer-looking listbox on desktop and a worse control on
 * a phone, where the native picker is a full-height wheel the OS already
 * optimised. This app is phone-first, so the native element wins. The only
 * thing added is a chevron, because `appearance-none` is needed to stop the
 * browser drawing its own inside our border.
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <div className="relative inline-flex w-full">
      <select
        ref={ref}
        className={cn(controlBase, controlHeight, 'appearance-none pr-9', className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
    </div>
  ),
);
Select.displayName = 'Select';

export { Select };
