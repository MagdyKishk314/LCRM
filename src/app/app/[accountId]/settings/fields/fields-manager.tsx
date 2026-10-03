'use client';

import * as React from 'react';
import { AlertCircle, Plus, Trash2, X } from 'lucide-react';
import type { CustomFieldDef, CustomFieldType } from '@/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { createField, deleteField } from '@/lib/actions/core';

const TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Choice (one)' },
  { value: 'multiselect', label: 'Choice (many)' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'url', label: 'URL' },
];

const NEEDS_OPTIONS = new Set<CustomFieldType>(['select', 'multiselect']);

/** CORE-12 — custom field definitions for contacts and opportunities. */
export function FieldsManager({
  accountId,
  fields,
  canManage,
}: {
  accountId: string;
  fields: CustomFieldDef[];
  canManage: boolean;
}) {
  const [adding, setAdding] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [type, setType] = React.useState<CustomFieldType>('text');
  const [entity, setEntity] = React.useState<'contact' | 'opportunity'>('contact');
  const [options, setOptions] = React.useState('');
  const [required, setRequired] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  function reset() {
    setLabel('');
    setType('text');
    setEntity('contact');
    setOptions('');
    setRequired(false);
    setError(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedOptions = options
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    if (NEEDS_OPTIONS.has(type) && parsedOptions.length === 0) {
      setError('Choice fields need at least one option.');
      return;
    }

    startTransition(async () => {
      const res = await createField(accountId, {
        entity,
        label: label.trim(),
        type,
        options: NEEDS_OPTIONS.has(type) ? parsedOptions : undefined,
        required,
      });

      if (res.ok) {
        reset();
        setAdding(false);
      } else {
        setError(res.error);
      }
    });
  }

  function onDelete(id: string) {
    setDeletingId(id);
    startTransition(async () => {
      const res = await deleteField(accountId, id);
      if (!res.ok) setError(res.error);
      setDeletingId(null);
    });
  }

  const byEntity = {
    contact: fields.filter((f) => f.entity === 'contact'),
    opportunity: fields.filter((f) => f.entity === 'opportunity'),
  };

  return (
    <div className="space-y-5">
      {error && !adding && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] text-danger">{error}</p>
        </div>
      )}

      {canManage &&
        (adding ? (
          <form onSubmit={onSubmit} className="rounded-card border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-fg">New field</h3>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  reset();
                }}
                aria-label="Cancel"
                className="text-fg-subtle transition-colors hover:text-fg"
              >
                <X size={15} />
              </button>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2"
              >
                <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
                <p className="text-[13px] text-danger">{error}</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Label htmlFor="f-label">Label</Label>
                <Input
                  id="f-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                  placeholder="Motivation level"
                />
              </div>
              <div>
                <Label htmlFor="f-entity">Applies to</Label>
                <Select
                  id="f-entity"
                  value={entity}
                  onChange={(e) => setEntity(e.target.value as 'contact' | 'opportunity')}
                >
                  <option value="contact">Contacts</option>
                  <option value="opportunity">Opportunities</option>
                </Select>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="f-type">Type</Label>
                <Select
                  id="f-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as CustomFieldType)}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>

              {NEEDS_OPTIONS.has(type) && (
                <div className="sm:col-span-2">
                  <Label htmlFor="f-options">Options</Label>
                  <Input
                    id="f-options"
                    value={options}
                    onChange={(e) => setOptions(e.target.value)}
                    placeholder="Low, Medium, High"
                  />
                  <p className="mt-1 text-[11px] text-fg-subtle">Comma-separated.</p>
                </div>
              )}
            </div>

            <label className="mt-3 flex items-center gap-2 text-[13px] text-fg-muted">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
                className="cursor-pointer accent-[var(--color-brand)]"
              />
              Required
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  reset();
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending || !label.trim()}>
                {pending ? 'Creating…' : 'Create field'}
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={13} /> New field
          </Button>
        ))}

      {(['contact', 'opportunity'] as const).map((ent) => (
        <section key={ent}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
            {ent === 'contact' ? 'Contact fields' : 'Opportunity fields'}
          </h3>

          <div className="overflow-hidden rounded-card border border-border bg-surface">
            {byEntity[ent].length === 0 && (
              <p className="px-4 py-8 text-center text-[13px] text-fg-subtle">
                No custom {ent} fields yet.
              </p>
            )}

            {byEntity[ent].map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-fg">{f.label}</p>
                  <code className="text-[11px] text-fg-subtle">{f.key}</code>
                </div>

                <Badge>{TYPES.find((t) => t.value === f.type)?.label ?? f.type}</Badge>
                {f.required && <Badge tone="warning">Required</Badge>}

                {canManage && (
                  <button
                    onClick={() => onDelete(f.id)}
                    disabled={deletingId === f.id}
                    aria-label={`Delete ${f.label}`}
                    className="text-fg-subtle transition-colors hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
