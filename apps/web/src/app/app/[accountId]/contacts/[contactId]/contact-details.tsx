'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Mail, MapPin, Phone, Plus, Tag as TagIcon, X } from 'lucide-react';
import { CONTACT_STATUS_LABEL, CONTACT_STATUSES, formatPhone, isUsPhone, type ContactDetail } from '@landcaller/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { checkDuplicates, updateContact } from '@/lib/actions/contacts';
import type { Facets } from './page';

/**
 * CNT-20 — the person: everything about them except parcels and custom fields, which have
 * their own cards. Read mode is the default because this page is mostly read during a
 * call; editing is an explicit switch on this card alone.
 */
export function ContactDetails({
  accountId,
  contact,
  facets,
  canEdit,
}: {
  accountId: string;
  contact: ContactDetail;
  facets: Facets;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [duplicate, setDuplicate] = React.useState<{ id: string; name: string } | null>(null);

  const initial = React.useMemo(
    () => ({
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone ?? '',
      altPhones: contact.altPhones ?? [],
      email: contact.email ?? '',
      company: contact.company ?? '',
      status: contact.status,
      source: contact.source ?? '',
      ownerId: contact.ownerId ?? '',
      tags: contact.tags,
      street: contact.address?.street ?? '',
      city: contact.address?.city ?? '',
      state: contact.address?.state ?? '',
      postalCode: contact.address?.postalCode ?? '',
    }),
    [contact],
  );
  const [form, setForm] = React.useState(initial);
  const [tagInput, setTagInput] = React.useState('');

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function begin() {
    setForm(initial);
    setError(null);
    setDuplicate(null);
    setEditing(true);
  }

  // A phone or email that already belongs to someone else is pointed out, not refused.
  React.useEffect(() => {
    if (!editing) return;
    const phone = form.phone.trim();
    const email = form.email.trim();
    if (!phone && !email) return setDuplicate(null);
    const timer = setTimeout(async () => {
      const res = await checkDuplicates(accountId, { phone, email, exclude: contact.id });
      const hit = res.ok ? res.data[0] : undefined;
      setDuplicate(hit ? { id: hit.id, name: `${hit.firstName} ${hit.lastName}` } : null);
    }, 400);
    return () => clearTimeout(timer);
  }, [editing, form.phone, form.email, accountId, contact.id]);

  function addTag() {
    const tag = tagInput.trim();
    if (tag && !form.tags.includes(tag)) set('tags', [...form.tags, tag]);
    setTagInput('');
  }

  function save() {
    setError(null);
    if (!form.firstName.trim() || !form.lastName.trim()) return setError('A first and last name are required.');

    startTransition(async () => {
      const res = await updateContact(accountId, contact.id, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim() || undefined,
        altPhones: form.altPhones.map((p) => p.trim()).filter(Boolean),
        email: form.email.trim(),
        company: form.company.trim() || undefined,
        status: form.status,
        source: form.source.trim() || undefined,
        ownerId: form.ownerId || null,
        tags: form.tags,
        address: {
          street: form.street.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          postalCode: form.postalCode.trim() || undefined,
        },
      });

      if (res.ok) {
        setEditing(false);
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  if (!editing) {
    const address = [contact.address?.street, [contact.address?.city, contact.address?.state].filter(Boolean).join(', '), contact.address?.postalCode]
      .filter(Boolean)
      .join(' · ');

    return (
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Contact details</CardTitle>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1 text-[12px] font-medium text-success">
                <Check size={12} /> Saved
              </span>
            )}
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={begin}>
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          <Field icon={<Phone size={13} />} label="Phone" value={contact.phone ? formatPhone(contact.phone) : undefined} mono
            note={contact.phone && !isUsPhone(contact.phone) ? 'Not a US number' : undefined} />
          {(contact.altPhones ?? []).length > 0 && (
            <Field label="Other phones" value={(contact.altPhones ?? []).map(formatPhone).join(' · ')} mono />
          )}
          <Field icon={<Mail size={13} />} label="Email" value={contact.email} />
          <Field icon={<MapPin size={13} />} label="Mailing address" value={address || undefined} />
          <Field label="Company" value={contact.company} />
          <Field label="Source" value={contact.source} />
          <Field label="Owner" value={contact.owner?.name} />
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              <TagIcon size={12} /> Tags
            </p>
            <div className="flex flex-wrap gap-1">
              {contact.tags.length > 0 ? contact.tags.map((t) => <Badge key={t}>{t}</Badge>) : <span className="text-[13px] text-fg-subtle">None</span>}
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit contact</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {error && <Alert>{error}</Alert>}
        {duplicate && (
          <div className="rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2 text-[13px] text-warning">
            This phone or email already belongs to{' '}
            <a href={`/app/${accountId}/contacts/${duplicate.id}`} className="font-medium underline">
              {duplicate.name}
            </a>
            . Consider merging instead.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="e-first">First name</Label>
            <Input id="e-first" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="e-last">Last name</Label>
            <Input id="e-last" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required />
          </div>
        </div>

        <div>
          <Label htmlFor="e-status">Status</Label>
          <Select id="e-status" value={form.status} onChange={(e) => set('status', e.target.value as typeof form.status)}>
            {CONTACT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CONTACT_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          {form.status === 'do_not_call' && <p className="mt-1 text-[11px] text-danger">This also sets the DNC flag the dialer checks.</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="e-phone">Phone</Label>
            <Input id="e-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            {form.phone.trim() && !isUsPhone(form.phone) && <p className="mt-1 text-[11px] text-warning">Not a US number; it will not be matched or dialled.</p>}
          </div>
          <div>
            <Label htmlFor="e-email">Email</Label>
            <Input id="e-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
        </div>

        <div>
          <Label>Other phones</Label>
          <div className="space-y-1.5">
            {form.altPhones.map((p, i) => (
              <div key={i} className="flex gap-1.5">
                <Input value={p} onChange={(e) => set('altPhones', form.altPhones.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Other phone ${i + 1}`} />
                <Button type="button" variant="ghost" size="sm" aria-label="Remove phone" onClick={() => set('altPhones', form.altPhones.filter((_, j) => j !== i))}>
                  <X size={13} />
                </Button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={() => set('altPhones', [...form.altPhones, ''])}>
              <Plus size={13} /> Add phone
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="e-company">Company</Label>
            <Input id="e-company" value={form.company} onChange={(e) => set('company', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="e-source">Source</Label>
            <Input id="e-source" value={form.source} onChange={(e) => set('source', e.target.value)} list="source-options" />
            <datalist id="source-options">
              {facets.sources.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        </div>

        <div>
          <Label htmlFor="e-owner">Owner</Label>
          <Select id="e-owner" value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
            <option value="">Unassigned</option>
            {facets.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="e-tag">Tags</Label>
          <div className="mb-1.5 flex flex-wrap gap-1">
            {form.tags.map((t) => (
              <Badge key={t}>
                {t}
                <button type="button" aria-label={`Remove tag ${t}`} onClick={() => set('tags', form.tags.filter((x) => x !== t))} className="ml-0.5 hover:text-danger">
                  <X size={10} />
                </button>
              </Badge>
            ))}
          </div>
          <Input
            id="e-tag"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
            placeholder="Type a tag and press Enter"
            list="tag-options"
          />
          <datalist id="tag-options">
            {facets.tags.filter((t) => !form.tags.includes(t)).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <div className="border-t border-border pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Mailing address</p>
          <div className="grid grid-cols-6 gap-3">
            <div className="col-span-6">
              <Label htmlFor="e-street">Street</Label>
              <Input id="e-street" value={form.street} onChange={(e) => set('street', e.target.value)} />
            </div>
            <div className="col-span-3">
              <Label htmlFor="e-city">City</Label>
              <Input id="e-city" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
            <div className="col-span-1">
              <Label htmlFor="e-state">State</Label>
              <Input id="e-state" value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase())} maxLength={2} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="e-zip">ZIP</Label>
              <Input id="e-zip" value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2">
      <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
      <p className="text-[13px] text-danger">{children}</p>
    </div>
  );
}

export function Field({
  icon,
  label,
  value,
  mono,
  note,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string | null;
  mono?: boolean;
  note?: string;
}) {
  return (
    <div>
      <p className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
        {icon}
        {label}
      </p>
      <p className={`text-[13px] ${value ? 'text-fg' : 'text-fg-subtle'} ${mono ? 'tabular' : ''}`}>
        {value || '—'}
        {note && <span className="ml-1.5 text-[11px] text-warning">{note}</span>}
      </p>
    </div>
  );
}
