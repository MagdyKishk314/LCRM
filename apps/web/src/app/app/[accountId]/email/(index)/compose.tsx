'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, PenSquare, X } from 'lucide-react';
import type { EmailIdentity, EmailTemplate } from '@landcaller/shared';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { sendEmail } from '@/lib/actions/email';

export interface ComposeContact {
  id: string;
  name: string;
  email?: string;
  doNotContact: boolean;
}

/** Split a typed recipient list on commas, semicolons and whitespace. */
function addresses(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((a) => a.trim())
    .filter(Boolean);
}

/**
 * Write and send one email.
 *
 * Opens on its own when the page was reached with a contact — that is someone clicking
 * "Email" on a contact, and making them click Compose as well would be a second ask for
 * the same thing.
 */
export function Compose({
  accountId,
  identities,
  templates,
  contact,
}: {
  accountId: string;
  /** Verified sending addresses only; an unverified one cannot send. */
  identities: EmailIdentity[];
  templates: EmailTemplate[];
  contact: ComposeContact | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(Boolean(contact));
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const defaultIdentity = identities.find((i) => i.isDefault) ?? identities[0];

  const [to, setTo] = React.useState(contact?.email ?? '');
  const [identityId, setIdentityId] = React.useState(defaultIdentity?.id ?? '');
  const [templateId, setTemplateId] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');

  function close() {
    setOpen(false);
    setError(null);
    // Drop `?contactId=` so a refresh does not reopen a composer the user dismissed.
    if (contact) router.replace(`/app/${accountId}/email`);
  }

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    if (!template) return;
    // Copied into the fields rather than sent by id, so what is on screen is what goes out.
    setSubject(template.subject);
    setBody(template.body);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const recipients = addresses(to);
    if (recipients.length === 0) return setError('Add at least one recipient.');

    startTransition(async () => {
      const res = await sendEmail(accountId, {
        to: recipients,
        subject: subject.trim(),
        body,
        identityId: identityId || undefined,
        contactId: contact?.id,
      });

      if (res.ok) {
        setSubject('');
        setBody('');
        setTemplateId('');
        setOpen(false);
        router.replace(`/app/${accountId}/email`);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <PenSquare size={13} /> Compose
      </Button>
    );
  }

  const hasMergeFields = /\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/.test(`${subject}\n${body}`);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-fg/20 p-4 pt-16"
      role="dialog"
      aria-modal="true"
      aria-label="New email"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-xl rounded-card border border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">
            {contact ? `Email ${contact.name}` : 'New email'}
          </h2>
          <button
            onClick={close}
            aria-label="Close"
            className="text-fg-subtle transition-colors hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-[13px] text-danger">{error}</p>
            </div>
          )}

          {contact?.doNotContact && (
            <div
              role="alert"
              className="rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2 text-[13px] text-danger"
            >
              {contact.name} is marked do-not-contact. This message will be refused.
            </div>
          )}

          {identities.length === 0 ? (
            <div className="rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2 text-[13px] text-warning">
              There is no verified sending address yet. Add one under Sending addresses, and
              confirm it from the email that is sent to it.
            </div>
          ) : (
            <div>
              <Label htmlFor="e-from">From</Label>
              <Select id="e-from" value={identityId} onChange={(e) => setIdentityId(e.target.value)}>
                {identities.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.fromName} &lt;{i.fromEmail}&gt;
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="e-to">To</Label>
            <Input
              id="e-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="owner@example.com"
              required
              autoFocus={!contact?.email}
            />
            <p className="mt-1 text-[11px] text-fg-subtle">Separate several addresses with commas.</p>
          </div>

          {templates.length > 0 && (
            <div>
              <Label htmlFor="e-template">Template</Label>
              <Select
                id="e-template"
                value={templateId}
                onChange={(e) => applyTemplate(e.target.value)}
              >
                <option value="">None</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="e-subject">Subject</Label>
            <Input
              id="e-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              maxLength={300}
            />
          </div>

          <div>
            <Label htmlFor="e-body">Message</Label>
            <Textarea
              id="e-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              required
            />
            {hasMergeFields && !contact && (
              <p className="mt-1 text-[11px] text-warning">
                This message uses merge fields, which are filled in from a contact. Sent from
                here they will be left blank — start from a contact&apos;s page instead.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={pending || identities.length === 0 || !subject.trim() || !body.trim()}
            >
              {pending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
