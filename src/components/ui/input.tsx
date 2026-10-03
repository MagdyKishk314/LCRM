import * as React from 'react';
import { cn } from '@/lib/cn';

const FIELD = cn(
  'w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg',
  'placeholder:text-fg-subtle transition-colors',
  'hover:border-border-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15',
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-subtle',
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(FIELD, 'h-9', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(FIELD, 'py-2 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(FIELD, 'h-9 cursor-pointer pr-8', className)} {...props} />
));
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1.5 block text-[13px] font-medium text-fg-muted', className)}
      {...props}
    />
  );
}
