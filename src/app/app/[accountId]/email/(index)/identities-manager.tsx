'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import type { EmailIdentity } from '@/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import {
  createIdentity,
  deleteIdentity,
  makeDefaultIdentity,
  resendIdentityVerification,
} from '@/lib/actions/email';

/**
 * The addresses this sub-account may send from.
 *
 * An address has to be confirmed — by a link mailed to it — before anything can be sent
 * from it. Until then it sits here as pending, with a way to send the link again.
 */
export function IdentitiesManager({
  accountId,
  identities,
  canManage,
}: {
  accountId: string;
  identities: EmailIdentity[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [fromName, setFromName] = React.useState('');
  const [fromEmail, setFromEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  /** Shown only while SMTP is off, when the confirmation mail cannot deliver itself. */
  const [link, setLink] = React.useState<{ email: string; url: string } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function report(email: string, verifyUrl: string | null) {
    if (verifyUrl) {
      setLink({ email, url: verifyUrl });
      setNotice(null);
    } else {
      setLink(null);
      setNotice(`A confirmation link has been sent to ${email}.`);
    }
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await createIdentity(accountId, {
        fromName: fromName.trim(),
        fromEmail: fromEmail.trim(),
        // The first address is the obvious default; after that it is a deliberate choice.
        isDefault: identities.length === 0,
      });

      if (!res.ok) return setError(res.error);

      report(res.data.fromEmail, res.data.verifyUrl);
      setFromName('');
      setFromEmail('');
      setAdding(false);
      router.refresh();
    });
  }

  function run(task: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await task();
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  function onResend(identity: EmailIdentity) {
    setError(null);
    startTransition(async () => {
      const res = await resendIdentityVerification(accountId, identity.id);
      if (res.ok) report(identity.fromEmail, res.data.verifyUrl);
      else setError(res.error);
    });
  }

  function onDelete(identity: EmailIdentity) {
    if (!window.confirm(`Remove ${identity.fromEmail}? Nothing more can be sent from it.`)) return;
    run(() => deleteIdentity(accountId, identity.id));
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Sending addresses</CardTitle>
        {canManage && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus size={13} /> Add address
          </Button>
        )}
      </CardHeader>

      <CardBody className="space-y-3">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2"
          >
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[13px] text-danger">{error}</p>
          </div>
        )}

        {notice && <p className="text-[13px] text-success">{notice}</p>}

        {link && (
          <div className="rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2.5 text-[13px]">
            <p className="text-warning">
              Outgoing mail is not configured, so the confirmation could not be emailed. Open
              this link yourself, or pass it to whoever reads {link.email}:
            </p>
            <code className="mt-1.5 block break-all text-[12px] text-fg">{link.url}</code>
          </div>
        )}

        {identities.length === 0 && !adding && (
          <p className="text-[13px] text-fg-muted">
            No sending addresses yet. Email cannot be sent until one is added and confirmed.
          </p>
        )}

        {identities.map((identity) => (
          <div
            key={identity.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border pb-3 last:border-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-fg">{identity.fromName}</p>
              <p className="truncate text-[12px] text-fg-muted">{identity.fromEmail}</p>
            </div>

            {identity.isDefault && <Badge tone="brand">Default</Badge>}
            {identity.verified ? (
              <Badge tone="success">Verified</Badge>
            ) : (
              <Badge tone="warning">Awaiting confirmation</Badge>
            )}

            {canManage && (
              <div className="flex items-center gap-1">
                {!identity.verified && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => onResend(identity)}
                  >
                    Resend link
                  </Button>
                )}
                {identity.verified && !identity.isDefault && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => run(() => makeDefaultIdentity(accountId, identity.id))}
                  >
                    Make default
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  aria-label={`Remove ${identity.fromEmail}`}
                  onClick={() => onDelete(identity)}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            )}
          </div>
        ))}

        {adding && (
          <form onSubmit={onAdd} className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
            <div>
              <Label htmlFor="id-name">From name</Label>
              <Input
                id="id-name"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Ridgeline Land Co."
                required
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="id-email">From address</Label>
              <Input
                id="id-email"
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="offers@example.com"
                required
              />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? 'Adding…' : 'Add and send confirmation'}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
