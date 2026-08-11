import * as React from 'react';

import { cn } from '@/lib/utils';
import { controlBase, controlHeight } from './control';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        controlBase,
        controlHeight,
        // File inputs render their own button, which the shared border would
        // otherwise draw a second box around.
        'file:text-foreground file:border-input file:mr-3 file:h-full file:cursor-pointer file:border-0 file:border-r file:bg-transparent file:pr-3 file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
