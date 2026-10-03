'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Star, Trash2 } from 'lucide-react';
import type { ContactDetail, PropertyInfo } from '@/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { updateContact } from '@/lib/actions/contacts';
import { Alert, Field } from './contact-details';

/**
 * CNT-22 — the parcels. A land owner often holds several; one is primary and that is the
 * one the table, the search and the exports use. The whole set is edited and saved as one.
 */
export function ParcelsCard({
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
  const [parcels, setParcels] = React.useState<PropertyInfo[]>(contact.properties);

  function begin() {
    setParcels(contact.properties.length ? contact.properties : [{ isPrimary: true }]);
    setError(null);
    setEditing(true);
  }

  function update(i: number, patch: Partial<PropertyInfo>) {
    setParcels((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }

  function makePrimary(i: number) {
    setParcels((list) => list.map((p, j) => ({ ...p, isPrimary: j === i })));
  }

  function remove(i: number) {
    setParcels((list) => {
      const next = list.filter((_, j) => j !== i);
      if (next.length && !next.some((p) => p.isPrimary)) next[0] = { ...next[0]!, isPrimary: true };
      return next;
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateContact(accountId, contact.id, {
        properties: parcels.map((p) => ({
          id: p.id,
          isPrimary: p.isPrimary,
          apn: p.apn?.trim() || undefined,
          county: p.county?.trim() || undefined,
          state: p.state?.trim().toUpperCase() || undefined,
          acres: p.acres === undefined || p.acres === null || (p.acres as unknown) === '' ? undefined : Number(p.acres),
          assessedValue:
            p.assessedValue === undefined || p.assessedValue === null || (p.assessedValue as unknown) === '' ? undefined : Number(p.assessedValue),
          legalDescription: p.legalDescription?.trim() || undefined,
        })),
      });
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
          <CardTitle>
            {contact.properties.length > 1 ? `Parcels (${contact.properties.length})` : 'Parcel'}
          </CardTitle>
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={begin}>
              Edit
            </Button>
          )}
        </CardHeader>
        <CardBody className="space-y-4">
          {contact.properties.length === 0 && <p className="text-[13px] text-fg-subtle">No parcel recorded.</p>}
          {contact.properties.map((p) => (
            <div key={p.id ?? p.apn} className="space-y-2 border-b border-border pb-3 last:border-0 last:pb-0">
              {contact.properties.length > 1 && p.isPrimary && (
                <Badge tone="brand">
                  <Star size={10} /> Primary
                </Badge>
              )}
              <Field label="APN" value={p.apn} mono />
              <Field label="County" value={p.county ? `${p.county} County, ${p.state ?? ''}`.trim() : p.state} />
              <Field label="Acreage" value={p.acres !== undefined && p.acres !== null ? `${p.acres} acres` : undefined} mono />
              <Field label="Assessed value" value={p.assessedValue ? `$${p.assessedValue.toLocaleString()}` : undefined} mono />
              {p.legalDescription && <Field label="Legal description" value={p.legalDescription} />}
            </div>
          ))}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit parcels</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {error && <Alert>{error}</Alert>}

        {parcels.map((p, i) => (
          <div key={p.id ?? i} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => makePrimary(i)}
                className={`flex items-center gap-1 text-[12px] font-medium ${p.isPrimary ? 'text-brand-text' : 'text-fg-subtle hover:text-fg'}`}
              >
                <Star size={12} fill={p.isPrimary ? 'currentColor' : 'none'} /> {p.isPrimary ? 'Primary' : 'Make primary'}
              </button>
              <Button type="button" variant="ghost" size="sm" aria-label="Remove parcel" onClick={() => remove(i)}>
                <Trash2 size={13} />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor={`p-apn-${i}`}>APN</Label>
                <Input id={`p-apn-${i}`} value={p.apn ?? ''} onChange={(e) => update(i, { apn: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`p-acres-${i}`}>Acres</Label>
                <Input id={`p-acres-${i}`} type="number" step="0.01" min="0" value={p.acres ?? ''} onChange={(e) => update(i, { acres: e.target.value as unknown as number })} />
              </div>
              <div>
                <Label htmlFor={`p-county-${i}`}>County</Label>
                <Input id={`p-county-${i}`} value={p.county ?? ''} onChange={(e) => update(i, { county: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`p-state-${i}`}>State</Label>
                <Input id={`p-state-${i}`} value={p.state ?? ''} maxLength={2} onChange={(e) => update(i, { state: e.target.value.toUpperCase() })} />
              </div>
              <div className="col-span-2">
                <Label htmlFor={`p-value-${i}`}>Assessed value</Label>
                <Input id={`p-value-${i}`} type="number" min="0" value={p.assessedValue ?? ''} onChange={(e) => update(i, { assessedValue: e.target.value as unknown as number })} />
              </div>
              <div className="col-span-2">
                <Label htmlFor={`p-legal-${i}`}>Legal description</Label>
                <Input id={`p-legal-${i}`} value={p.legalDescription ?? ''} onChange={(e) => update(i, { legalDescription: e.target.value })} />
              </div>
            </div>
          </div>
        ))}

        <Button type="button" variant="outline" size="sm" onClick={() => setParcels((l) => [...l, { isPrimary: l.length === 0 }])}>
          <Plus size={13} /> Add parcel
        </Button>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save parcels'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
