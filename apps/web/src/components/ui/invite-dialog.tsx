'use client';

import * as React from 'react';
import { Check, Copy, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The one-time setup link produced by an invite.
 *
 * A dialog rather than an inline panel, because this is the only time the link is ever
 * visible and an inline panel inherits whatever space its trigger happened to have —
 * which, in a page header's action strip, was almost none. Dismissal is deliberate: it
 * closes on Escape, on the backdrop and on Done, but never on its own.
 */
export function InviteDialog({
  email,
  url,
  expiresAt,
  onDismiss,
}: {
  email: string;
  url: string;
  expiresAt?: string | null;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const copyRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    copyRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the field below is selectable as a fallback.
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-dialog-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-card border border-border bg-surface p-6 shadow-lg">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle">
            <Mail size={17} className="text-brand-text" />
          </div>
          <div className="min-w-0">
            <h2 id="invite-dialog-title" className="text-[15px] font-semibold text-fg">
              Send this link to {email}
            </h2>
            <p className="mt-1 text-[13px] text-fg-muted">
              It lets them set a password and sign in. It works once
              {expiresAt
                ? `, and expires ${new Date(expiresAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}`
                : ' and expires in seven days'}
              .
            </p>
          </div>
        </div>

        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Invite link"
          className="h-10 w-full rounded-lg border border-border bg-surface-2 px-3 font-mono text-[12px] text-fg"
        />

        <p className="mt-3 text-[12px] text-fg-subtle">
          This is the only time this link is shown. If you lose it, invite them again to
          issue a new one — the old link stops working.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
            Done
          </Button>
          <Button ref={copyRef} type="button" size="sm" onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      </div>
    </div>
  );
}
