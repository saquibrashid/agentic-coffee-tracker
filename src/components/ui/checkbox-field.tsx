import * as React from 'react';

import { cn } from '@/lib/utils';

export interface CheckboxFieldProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type'
> {
  label: React.ReactNode;
  /** Optional explanatory line beneath the label. */
  description?: React.ReactNode;
}

/**
 * A checkbox and its label as one unit.
 *
 * The two are inseparable in practice — a checkbox without a label is not a
 * control anyone can use — and binding them here is what guarantees the whole
 * row is clickable and at least 44px tall, which is the rule the hand-rolled
 * versions kept missing.
 *
 * `accent-color` rather than a hand-drawn box: it recolours the native control
 * to the theme in one line while keeping the platform's own checked, focus and
 * high-contrast-mode rendering, all of which a custom box has to reimplement
 * and usually gets wrong.
 */
const CheckboxField = React.forwardRef<HTMLInputElement, CheckboxFieldProps>(
  ({ className, label, description, ...props }, ref) => (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-3 text-sm',
        props.disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <input ref={ref} type="checkbox" className="accent-primary size-4 shrink-0" {...props} />
      <span>
        {label}
        {description !== undefined && (
          <span className="text-muted-foreground block text-xs">{description}</span>
        )}
      </span>
    </label>
  ),
);
CheckboxField.displayName = 'CheckboxField';

export { CheckboxField };
