'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Pencil, Plus, X } from 'lucide-react';
import type { EmailTemplate } from '@landcaller/shared';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { deleteTemplate, saveTemplate } from '@/lib/actions/email';

/** The merge fields a template may use — the roots the API's renderer allows. */
const FIELDS = [
  'contact.firstName',
  'contact.lastName',
  'contact.property.acres',
  'contact.property.county',
  'contact.property.state',
  'contact.property.apn',
  'user.firstName',
  'user.lastName',
  'account.name',
];

/**
 * Create a template, or edit the one passed in.
 *
 * One component for both so the two forms cannot drift; with no `template` it renders the
 * "New template" button, with one it renders an edit icon on that template's card.
 */
export function TemplateEditor({
  accountId,
  template,
}: {
  accountId: string;
  template?: EmailTemplate;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const [name, setName] = React.useState(template?.name ?? '');
  const [category, setCategory] = React.useState(template?.category ?? '');
  const [subject, setSubject] = React.useState(template?.subject ?? '');
  const [body, setBody] = React.useState(template?.body ?? '');

  function reset() {
    setName(template?.name ?? '');
    setCategory(template?.category ?? '');
    setSubject(template?.subject ?? '');
    setBody(template?.body ?? '');
    setError(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await saveTemplate(accountId, template?.id, {
        name: name.trim(),
        subject: subject.trim(),
        body,
        category: category.trim() || undefined,
      });

      if (!res.ok) return setError(res.error);

      setOpen(false);
      if (!template) reset();
      router.refresh();
    });
  }

  function onDelete() {
    if (!template) return;
    if (!window.confirm(`Delete the template "${template.name}"?`)) return;

    startTransition(async () => {
      const res = await deleteTemplate(accountId, template.id);
      if (!res.ok) return setError(res.error);
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return template ? (
      <button
        onClick={() => setOpen(true)}
        aria-label={`Edit ${template.name}`}
        className="text-fg-subtle transition-colors hover:text-fg"
      >
        <Pencil size={14} />
      </button>
    ) : (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={13} /> New template
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-fg/20 p-4 pt-16"
      role="dialog"
      aria-modal="true"
      aria-label={template ? 'Edit template' : 'New template'}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-xl rounded-card border border-border bg-surface text-left shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">
            {template ? 'Edit template' : 'New template'}
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

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="t-name">Name</Label>
              <Input
                id="t-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                maxLength={120}
              />
            </div>
            <div>
              <Label htmlFor="t-category">Category</Label>
              <Input
                id="t-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Offers"
                maxLength={60}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="t-subject">Subject</Label>
            <Input
              id="t-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              maxLength={300}
            />
          </div>

          <div>
            <Label htmlFor="t-body">Message</Label>
            <Textarea
              id="t-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              required
            />
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              Merge fields — click to add to the message
            </p>
            <div className="flex flex-wrap gap-1">
              {FIELDS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setBody((b) => `${b}{{${f}}}`)}
                  className="rounded bg-brand-subtle px-1.5 py-0.5 text-[11px] text-brand-text transition-opacity hover:opacity-80"
                >
                  {`{{${f}}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            {template ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-danger"
                disabled={pending}
                onClick={onDelete}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={pending || !name.trim() || !subject.trim() || !body.trim()}
              >
                {pending ? 'Saving…' : template ? 'Save changes' : 'Create template'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
