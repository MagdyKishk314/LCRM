'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ContactDetail, CustomFieldDef } from '@landcaller/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { updateContact } from '@/lib/actions/contacts';
import { Alert, Field } from './contact-details';

/**
 * CNT-21 — custom fields, rendered and edited by their definition's type.
 *
 * Values under keys that no longer have a definition are shown under "Other" rather than
 * hidden: deleting a definition hides the field from forms, not the data from the record.
 */
export function CustomFieldsCard({
  accountId,
  contact,
  canEdit,
}: {
  accountId: string;
  contact: ContactDetail;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [values, setValues] = React.useState<Record<string, unknown>>(contact.customFields ?? {});

  const defs = contact.fieldDefinitions;
  const defined = new Set(defs.map((d) => d.key));
  const orphans = Object.entries(contact.customFields ?? {}).filter(([k]) => !defined.has(k));

  function save() {
    setError(null);
    startTransition(async () => {
      const payload: Record<string, unknown> = {};
      for (const def of defs) payload[def.key] = values[def.key] ?? '';
      const res = await updateContact(accountId, contact.id, { customFields: payload });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (!editing) {
    return (
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Custom fields</CardTitle>
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={() => { setValues(contact.customFields ?? {}); setError(null); setEditing(true); }}>
              Edit
            </Button>
          )}
        </CardHeader>
        <CardBody className="space-y-3">
          {defs.map((def) => (
            <Field key={def.key} label={def.label} value={display(def, contact.customFields?.[def.key])} mono={def.type === 'number' || def.type === 'currency'} />
          ))}
          {orphans.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Other</p>
              {orphans.map(([k, v]) => (
                <Field key={k} label={k} value={Array.isArray(v) ? v.join(', ') : String(v)} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit custom fields</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {error && <Alert>{error}</Alert>}
        {defs.map((def) => (
          <div key={def.key}>
            <Label htmlFor={`cf-${def.key}`}>
              {def.label}
              {def.required && <span className="text-danger"> *</span>}
            </Label>
            <FieldInput def={def} value={values[def.key]} onChange={(v) => setValues((s) => ({ ...s, [def.key]: v }))} />
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function display(def: CustomFieldDef, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  switch (def.type) {
    case 'checkbox':
      return value ? 'Yes' : 'No';
    case 'currency':
      return `$${Number(value).toLocaleString()}`;
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : String(value);
    default:
      return String(value);
  }
}

/** One input, shaped by the field's type. Shared with the create form. */
export function FieldInput({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `cf-${def.key}`;
  switch (def.type) {
    case 'textarea':
      return <Textarea id={id} rows={3} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
    case 'currency':
      return <Input id={id} type="number" step="any" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <Input id={id} type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-[13px] text-fg">
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="accent-brand" />
          {value ? 'Yes' : 'No'}
        </label>
      );
    case 'select':
      return (
        <Select id={id} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(def.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(def.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-1.5 text-[13px] text-fg">
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={(e) => onChange(e.target.checked ? [...selected, o] : selected.filter((s) => s !== o))}
                className="accent-brand"
              />
              {o}
            </label>
          ))}
        </div>
      );
    }
    case 'email':
      return <Input id={id} type="email" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'url':
      return <Input id={id} type="url" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <Input id={id} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}
