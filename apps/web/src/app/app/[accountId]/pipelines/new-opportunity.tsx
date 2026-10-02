'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Plus, X } from 'lucide-react';
import type { Contact, Pipeline } from '@landcaller/shared';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { createOpportunity } from '@/lib/actions/pipelines';

type BoardContact = Pick<Contact, 'id' | 'firstName' | 'lastName' | 'phone' | 'email'>;

/**
 * PIP-07 — add an opportunity.
 *
 * The contact list here is the one already on the board, so it only covers people who
 * have an opportunity. Adding a deal for a brand-new owner starts from their contact
 * record, which is the natural order of work anyway.
 */
export function NewOpportunity({
  accountId,
  pipeline,
  contacts,
}: {
  accountId: string;
  pipeline: Pipeline;
  contacts: BoardContact[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const stages = React.useMemo(
    () => [...pipeline.stages].sort((a, b) => a.order - b.order),
    [pipeline.stages],
  );

  const [form, setForm] = React.useState({
    name: '',
    contactId: contacts[0]?.id ?? '',
    stageId: stages[0]?.id ?? '',
    value: '',
    expectedCloseDate: '',
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await createOpportunity(accountId, {
        pipelineId: pipeline.id,
        stageId: form.stageId,
        contactId: form.contactId,
        name: form.name.trim(),
        value: Number(form.value) || 0,
        expectedCloseDate: form.expectedCloseDate || undefined,
      });

      if (res.ok) {
        setForm((f) => ({ ...f, name: '', value: '', expectedCloseDate: '' }));
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (contacts.length === 0) {
    return (
      <Button size="sm" disabled title="Add a contact first — an opportunity belongs to one">
        <Plus size={13} /> New opportunity
      </Button>
    );
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={13} /> New opportunity
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-fg/20 p-4 pt-16"
      role="dialog"
      aria-modal="true"
      aria-label="New opportunity"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-md rounded-card border border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">New opportunity</h2>
          <button onClick={() => setOpen(false)} aria-label="Close" className="text-fg-subtle hover:text-fg">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3 px-5 py-4">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-[13px] text-danger">{error}</p>
            </div>
          )}

          <div>
            <Label htmlFor="o-name">Name</Label>
            <Input
              id="o-name"
              autoFocus
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              placeholder="12 ac — Costilla Co, CO"
            />
          </div>

          <div>
            <Label htmlFor="o-contact">Contact</Label>
            <Select
              id="o-contact"
              value={form.contactId}
              onChange={(e) => setForm((f) => ({ ...f, contactId: e.target.value }))}
            >
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="o-stage">Stage</Label>
              <Select
                id="o-stage"
                value={form.stageId}
                onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value }))}
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="o-value">Value</Label>
              <Input
                id="o-value"
                type="number"
                min="0"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                placeholder="18000"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="o-close">Expected close</Label>
            <Input
              id="o-close"
              type="date"
              value={form.expectedCloseDate}
              onChange={(e) => setForm((f) => ({ ...f, expectedCloseDate: e.target.value }))}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !form.name.trim()}>
              {pending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
