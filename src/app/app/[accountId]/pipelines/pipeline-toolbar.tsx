'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ChevronsUpDown, Check, Plus, Settings2 } from 'lucide-react';
import type { Contact, Pipeline } from '@/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { createPipeline } from '@/lib/actions/pipelines';
import { NewOpportunity } from './new-opportunity';
import { StageEditor } from './stage-editor';

/** Stages a new pipeline starts with — a land deal from first touch to close. */
const STARTER_STAGES = [
  { name: 'New lead', color: 'info', probability: 10 },
  { name: 'Contact made', color: 'info', probability: 25 },
  { name: 'Offer sent', color: 'warning', probability: 45 },
  { name: 'Negotiating', color: 'warning', probability: 65 },
  { name: 'Under contract', color: 'brand', probability: 85 },
  { name: 'Closed', color: 'success', probability: 100 },
];

interface PipelineOption {
  id: string;
  name: string;
  isDefault: boolean;
}

/** PIP-03/04/05 — switch, create and edit pipelines. */
export function PipelineToolbar({
  accountId,
  pipelines,
  selected,
  canManage,
  canCreateOpportunity,
  contacts,
}: {
  accountId: string;
  pipelines: PipelineOption[];
  selected: Pipeline;
  canManage: boolean;
  canCreateOpportunity: boolean;
  contacts: Pick<Contact, 'id' | 'firstName' | 'lastName' | 'phone' | 'email'>[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [pickerOpen, setPickerOpen] = React.useState(false);
  // The empty-state link lands here with ?new=1 so creation is one click from there.
  const [creating, setCreating] = React.useState(params.get('new') === '1');
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const pickerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  function switchTo(id: string) {
    setPickerOpen(false);
    const next = new URLSearchParams(params.toString());
    next.set('pipeline', id);
    next.delete('new');
    startTransition(() => router.push(`?${next}`));
  }

  function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await createPipeline(accountId, {
        name: name.trim(),
        stages: STARTER_STAGES.map((s, i) => ({ ...s, order: i })),
        isDefault: pipelines.length === 0,
      });

      if (res.ok) {
        setName('');
        setCreating(false);
        switchTo(res.data.id);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="px-6 pb-3">
      {error && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] text-danger">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* Switcher */}
        <div ref={pickerRef} className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            aria-haspopup="listbox"
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-fg transition-colors hover:bg-surface-2"
          >
            {selected.name}
            <ChevronsUpDown size={13} className="text-fg-subtle" />
          </button>

          {pickerOpen && (
            <div
              role="listbox"
              className="absolute left-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
            >
              {pipelines.map((p) => (
                <button
                  key={p.id}
                  role="option"
                  aria-selected={p.id === selected.id}
                  onClick={() => switchTo(p.id)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors',
                    p.id === selected.id
                      ? 'bg-brand-subtle text-brand-text'
                      : 'text-fg hover:bg-surface-2',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.isDefault && <span className="text-[10px] text-fg-subtle">default</span>}
                  {p.id === selected.id && <Check size={13} className="shrink-0" />}
                </button>
              ))}

              {canManage && (
                <div className="mt-1 border-t border-border pt-1">
                  <button
                    onClick={() => {
                      setPickerOpen(false);
                      setCreating(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
                  >
                    <Plus size={13} /> New pipeline
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Settings2 size={13} /> Edit stages
            </Button>
          )}
          {canCreateOpportunity && (
            <NewOpportunity
              accountId={accountId}
              pipeline={selected}
              contacts={contacts}
            />
          )}
        </div>
      </div>

      {creating && (
        <form
          onSubmit={create}
          className="mt-3 flex flex-wrap items-end gap-2 rounded-card border border-border bg-surface p-3"
        >
          <div className="min-w-[220px] flex-1">
            <label htmlFor="p-name" className="mb-1 block text-[13px] font-medium text-fg-muted">
              Pipeline name
            </label>
            <input
              id="p-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Wholesale deals"
              required
              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending || !name.trim()}>
            {pending ? 'Creating…' : 'Create'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
            Cancel
          </Button>
          <p className="w-full text-[11px] text-fg-subtle">
            Starts with six stages from first touch to close. You can change them afterwards.
          </p>
        </form>
      )}

      {editing && (
        <StageEditor
          accountId={accountId}
          pipeline={selected}
          canDelete={pipelines.length > 1}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
