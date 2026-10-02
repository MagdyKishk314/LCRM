import * as React from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted border-border',
  brand: 'bg-brand-subtle text-brand-text border-brand-border',
  success: 'bg-success-subtle text-success border-success/25',
  warning: 'bg-warning-subtle text-warning border-warning/30',
  danger: 'bg-danger-subtle text-danger border-danger/25',
  info: 'bg-info-subtle text-info border-info/25',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
