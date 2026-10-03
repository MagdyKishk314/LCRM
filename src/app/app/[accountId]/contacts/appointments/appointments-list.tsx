'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CalendarClock, MapPin, Plus, Trash2, X } from 'lucide-react';
import type { Appointment } from '@/shared';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { createAppointment, deleteAppointment, updateAppointment } from '@/lib/actions/tasks';
import type { Facets } from '@/lib/contacts/facets';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { ContactPicker } from '../tasks/tasks-list';

export interface AppointmentRow extends Appointment {
  contact: { id: string; name: string; phone?: string } | null;
}

const OUTCOME_TONE: Record<Appointment['outcome'], 'neutral' | 'success' | 'danger' | 'warning' | 'info'> = {
  scheduled: 'info',
  held: 'success',
  no_show: 'danger',
  rescheduled: 'warning',
  cancelled: 'neutral',
};

type Tab = 'mine' | 'all' | 'past';

export function AppointmentsList({
  accountId,
  upcoming,
  past,
  facets,
  currentUserId,
  canManage,
}: {
  accountId: string;
  upcoming: AppointmentRow[];
  past: AppointmentRow[];
  facets: Facets;
  currentUserId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const timeZone = useSession().activeAccount?.timezone;
  const [tab, setTab] = React.useState<Tab>('mine');
  const [adding, setAdding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const ownerName = new Map(facets.owners.map((o) => [o.id, o.name]));

  const mine = upcoming.filter((a) => a.userId === currentUserId);
  const rows = tab === 'mine' ? mine : tab === 'all' ? upcoming : past;

  function act(task: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await task();
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] text-danger">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(['mine', 'all', 'past'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors', tab === t ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg')}>
            {t === 'mine' ? `Mine (${mine.length})` : t === 'all' ? `Everyone (${upcoming.length})` : 'Past'}
          </button>
        ))}
        {canManage && (
          <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}>
            <Plus size={13} /> Schedule
          </Button>
        )}
      </div>

      {adding && <NewAppointmentForm accountId={accountId} facets={facets} currentUserId={currentUserId} onClose={() => setAdding(false)} />}

      {rows.length === 0 && (
        <div className="rounded-card border border-border bg-surface px-4 py-14 text-center">
          <p className="text-sm font-medium text-fg">{tab === 'past' ? 'No past appointments' : 'Nothing scheduled'}</p>
          <p className="mt-1 text-[13px] text-fg-muted">Appointments are scheduled here or from a contact&apos;s page.</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="divide-y divide-border rounded-card border border-border bg-surface">
          {rows.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <CalendarClock size={14} className="text-fg-subtle" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-fg">{a.title}</p>
                <p className="flex flex-wrap gap-x-2 text-[12px] text-fg-subtle">
                  {a.contact && (
                    <Link href={`/app/${accountId}/contacts/${a.contact.id}`} className="text-brand-text hover:underline">
                      {a.contact.name}
                    </Link>
                  )}
                  {tab !== 'mine' && <span>with {ownerName.get(a.userId) ?? 'someone'}</span>}
                  {a.location && (
                    <span className="flex items-center gap-1">
                      <MapPin size={11} /> {a.location}
                    </span>
                  )}
                </p>
              </div>
              <span className="tabular text-[12px] text-fg-muted">{formatDateTime(a.startsAt, timeZone)}</span>
              <Badge tone={OUTCOME_TONE[a.outcome]}>{a.outcome.replace(/_/g, ' ')}</Badge>
              {canManage && (
                <>
                  <Select
                    defaultValue=""
                    aria-label="Record outcome"
                    className="h-7 w-auto text-[12px]"
                    disabled={pending}
                    onChange={(e) => {
                      const outcome = e.target.value as Appointment['outcome'];
                      if (outcome) act(() => updateAppointment(accountId, a.id, { outcome }, a.contactId));
                      e.target.value = '';
                    }}
                  >
                    <option value="">Outcome…</option>
                    <option value="held">Held</option>
                    <option value="no_show">No-show</option>
                    <option value="rescheduled">Rescheduled</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                  <button onClick={() => { if (window.confirm('Delete this appointment?')) act(() => deleteAppointment(accountId, a.id, a.contactId)); }} disabled={pending} aria-label="Delete appointment" className="text-fg-subtle hover:text-danger">
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewAppointmentForm({ accountId, facets, currentUserId, onClose }: { accountId: string; facets: Facets; currentUserId: string; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = React.useState('');
  const [startsAt, setStartsAt] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [userId, setUserId] = React.useState(currentUserId);
  const [contact, setContact] = React.useState<{ id: string; name: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!contact) return setError('Pick the contact the appointment is with.');
    startTransition(async () => {
      const res = await createAppointment(accountId, {
        contactId: contact.id,
        title: title.trim(),
        startsAt: new Date(startsAt).toISOString(),
        userId,
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (res.ok) {
        onClose();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Schedule an appointment</h3>
        <button type="button" onClick={onClose} aria-label="Cancel" className="text-fg-subtle hover:text-fg">
          <X size={15} />
        </button>
      </div>
      {error && <p className="mb-3 text-[13px] text-danger">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>With</Label>
          <ContactPicker accountId={accountId} value={contact} onChange={setContact} required />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="na-title">What</Label>
          <Input id="na-title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Site visit, offer call…" />
        </div>
        <div>
          <Label htmlFor="na-when">When</Label>
          <Input id="na-when" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="na-where">Where</Label>
          <Input id="na-where" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Address, or phone" />
        </div>
        <div>
          <Label htmlFor="na-who">Team member</Label>
          <Select id="na-who" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {facets.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="na-notes">Notes</Label>
          <Textarea id="na-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm" disabled={pending || !title.trim() || !startsAt}>{pending ? 'Scheduling…' : 'Schedule'}</Button>
      </div>
    </form>
  );
}
