'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Plus, X } from 'lucide-react';
import { CONTACT_STATUS_LABEL, CONTACT_STATUSES, isUsPhone, type CustomFieldDef } from '@/shared';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { checkDuplicates, createContact } from '@/lib/actions/contacts';
import type { Facets } from '@/lib/contacts/facets';
import { FieldInput } from './[contactId]/custom-fields-card';

/**
 * CNT-10 / CNT-44 — create a contact.
 *
 * Checks the phone and email against existing contacts as they are typed and offers the
 * existing record, so the second import of a vendor list does not start with a second
 * Wayne Kowalski. The warning never blocks the save.
 */
export function NewContact({ accountId, facets }: { accountId: string; facets: Facets }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [duplicate, setDuplicate] = React.useState<{ id: string; name: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const [form, setForm] = React.useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    status: 'new',
    source: 'Manual entry',
    ownerId: '',
    tags: '',
    apn: '',
    county: '',
    state: '',
    acres: '',
  });
  const [custom, setCustom] = React.useState<Record<string, unknown>>({});

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  React.useEffect(() => {
    if (!open) return;
    const phone = form.phone.trim();
    const email = form.email.trim();
    if (!phone && !email) return setDuplicate(null);
    const timer = setTimeout(async () => {
      const res = await checkDuplicates(accountId, { phone, email });
      const hit = res.ok ? res.data[0] : undefined;
      setDuplicate(hit ? { id: hit.id, name: `${hit.firstName} ${hit.lastName}` } : null);
    }, 400);
    return () => clearTimeout(timer);
  }, [open, form.phone, form.email, accountId]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await createContact(accountId, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        status: form.status,
        source: form.source.trim() || undefined,
        ownerId: form.ownerId || undefined,
        tags: form.tags.split(/[,;]/).map((t) => t.trim()).filter(Boolean),
        properties:
          form.apn || form.county || form.state || form.acres
            ? [{ isPrimary: true, apn: form.apn.trim() || undefined, county: form.county.trim() || undefined, state: form.state.trim().toUpperCase() || undefined, acres: form.acres ? Number(form.acres) : undefined }]
            : [],
        customFields: custom,
      });

      if (res.ok) {
        setOpen(false);
        router.push(`/app/${accountId}/contacts/${res.data.id}`);
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={13} /> New contact
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-fg/20 p-4 pt-16" role="dialog" aria-modal="true" aria-label="New contact" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="w-full max-w-lg rounded-card border border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">New contact</h2>
          <button onClick={() => setOpen(false)} aria-label="Close" className="text-fg-subtle transition-colors hover:text-fg">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-[13px] text-danger">{error}</p>
            </div>
          )}
          {duplicate && (
            <div className="rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2 text-[13px] text-warning">
              This phone or email already belongs to{' '}
              <a href={`/app/${accountId}/contacts/${duplicate.id}`} className="font-medium underline">
                {duplicate.name}
              </a>
              . Open that record instead?
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-first">First name</Label>
              <Input id="c-first" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} required autoFocus />
            </div>
            <div>
              <Label htmlFor="c-last">Last name</Label>
              <Input id="c-last" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="c-phone">Phone</Label>
              <Input id="c-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(719) 555-0142" />
              {form.phone.trim() && !isUsPhone(form.phone) && <p className="mt-1 text-[11px] text-warning">Not a US number.</p>}
            </div>
            <div>
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="c-status">Status</Label>
              <Select id="c-status" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {CONTACT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CONTACT_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="c-source">Source</Label>
              <Input id="c-source" value={form.source} onChange={(e) => set('source', e.target.value)} list="new-source-options" />
              <datalist id="new-source-options">
                {facets.sources.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <Label htmlFor="c-owner">Owner</Label>
              <Select id="c-owner" value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
                <option value="">Unassigned</option>
                {facets.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="c-tags">Tags</Label>
            <Input id="c-tags" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="comma-separated" list="new-tag-options" />
            <datalist id="new-tag-options">
              {facets.tags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>

          <div className="border-t border-border pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Parcel</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="c-apn">APN</Label>
                <Input id="c-apn" value={form.apn} onChange={(e) => set('apn', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="c-acres">Acres</Label>
                <Input id="c-acres" type="number" step="0.01" min="0" value={form.acres} onChange={(e) => set('acres', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="c-county">County</Label>
                <Input id="c-county" value={form.county} onChange={(e) => set('county', e.target.value)} list="new-county-options" />
                <datalist id="new-county-options">
                  {facets.counties.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <Label htmlFor="c-state">State</Label>
                <Input id="c-state" value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase())} maxLength={2} placeholder="CO" />
              </div>
            </div>
          </div>

          {facets.fields.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Custom fields</p>
              <div className="space-y-2">
                {facets.fields.map((def) => (
                  <div key={def.key}>
                    <Label htmlFor={`cf-${def.key}`}>
                      {def.label}
                      {def.required && <span className="text-danger"> *</span>}
                    </Label>
                    <FieldInput def={def as CustomFieldDef} value={custom[def.key]} onChange={(v) => setCustom((c) => ({ ...c, [def.key]: v }))} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !form.firstName.trim() || !form.lastName.trim()}>
              {pending ? 'Creating…' : 'Create contact'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
