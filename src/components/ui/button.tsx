'use client';

import * as React from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  // `brand-solid`, not `brand`: these labels are 13–14px, so they need 4.5:1 against
  // the fill rather than the 3:1 a decorative shape gets away with.
  primary: 'bg-brand-solid text-brand-fg hover:bg-brand-hover shadow-sm',
  secondary: 'bg-surface-2 text-fg hover:bg-border/60 border border-border',
  outline: 'bg-surface text-fg border border-border hover:bg-surface-2',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-danger text-white hover:opacity-90 shadow-sm',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
  icon: 'h-9 w-9 justify-center',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-lg font-medium transition-colors',
        // No `pointer-events-none` here: the `disabled` attribute already blocks clicks,
        // and killing pointer events would also suppress the `not-allowed` cursor that
        // tells someone why nothing happens.
        'disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
