'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { confirmSender } from '@/lib/actions/verify-sender';

/** The one button on the confirmation page, and what it says afterwards. */
export function ConfirmSender({ token }: { token: string }) {
  const [confirmed, setConfirmed] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await confirmSender(token);
      if (res.ok) setConfirmed(res.data.fromEmail);
      else setError(res.error);
    });
  }

  if (confirmed) {
    return (
      <div className="rounded-card border border-border bg-surface p-6 text-center shadow-sm">
        <CheckCircle2 size={28} className="mx-auto mb-3 text-success" />
        <p className="text-sm font-medium text-fg">{confirmed} is confirmed</p>
        <p className="mt-2 text-[13px] text-fg-muted">
          Email can now be sent from this address. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-border bg-surface p-6 shadow-sm">
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
          <div className="text-[13px] text-danger">
            <p>{error}</p>
            <p className="mt-1 text-fg-muted">
              Links work once and expire after seven days. Whoever added this address can send
              a new one from Email in the CRM.
            </p>
          </div>
        </div>
      )}

      <p className="mb-5 text-[13px] leading-relaxed text-fg-muted">
        Someone asked to send email from this address through LandCaller CRM. Confirm only if
        that was you, or someone you work with.
      </p>

      <Button size="lg" className="w-full justify-center" onClick={onConfirm} disabled={pending}>
        {pending ? 'Confirming…' : 'Yes, confirm this address'}
      </Button>
    </div>
  );
}
