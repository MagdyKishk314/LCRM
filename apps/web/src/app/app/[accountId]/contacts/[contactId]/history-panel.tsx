'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CalendarClock,
  CheckSquare,
  FileInput,
  GitMerge,
  ListFilter,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Sparkles,
  StickyNote,
  Trash2,
  Upload,
} from 'lucide-react';
import type { Activity, ActivityType, ContactDetail, HistoryEntry } from '@landcaller/shared';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { deleteNote, loadHistory, logActivity, updateNote } from '@/lib/actions/contacts';
import { createAppointment, createTask, updateAppointment, updateTask } from '@/lib/actions/tasks';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

type Tab = 'all' | 'note' | 'call' | 'email' | 'sms' | 'appointment' | 'task' | 'changes';

const TABS: { key: Tab; label: string; types: ActivityType[] | null }[] = [
  { key: 'all', label: 'All', types: null },
  { key: 'note', label: 'Notes', types: ['note'] },
  { key: 'call', label: 'Calls', types: ['call'] },
  { key: 'email', label: 'Emails', types: ['email'] },
  { key: 'sms', label: 'Texts', types: ['sms'] },
  { key: 'appointment', label: 'Appointments', types: ['appointment'] },
  { key: 'task', label: 'Tasks', types: ['task'] },
  { key: 'changes', label: 'Changes', types: ['status_change', 'stage_change', 'field_change', 'list_change', 'import', 'merge', 'created'] },
];

const ICON: Record<ActivityType, React.ReactNode> = {
  note: <StickyNote size={12} />,
  call: <Phone size={12} />,
  sms: <MessageSquare size={12} />,
  email: <Mail size={12} />,
  appointment: <CalendarClock size={12} />,
  task: <CheckSquare size={12} />,
  status_change: <Sparkles size={12} />,
  stage_change: <Sparkles size={12} />,
  field_change: <Pencil size={12} />,
  list_change: <ListFilter size={12} />,
  import: <Upload size={12} />,
  merge: <GitMerge size={12} />,
  created: <FileInput size={12} />,
};

type ComposerKind = 'note' | 'call' | 'task' | 'appointment';

/**
 * CNT-23 / CNT-24 / CNT-25 — the right-hand column: pinned notes, the composer, and the
 * history under tabs. "All" is one list; a tab is the same endpoint filtered by type, so
 * each tab paginates on its own cursor. "Changes" groups the record-keeping types, which
 * is a client-side filter of the unfiltered list because the endpoint takes one type.
 */
export function HistoryPanel({
  accountId,
  contact,
  owners,
  currentUserId,
  can,
}: {
  accountId: string;
  contact: ContactDetail;
  owners: { id: string; name: string }[];
  currentUserId: string;
  can: { edit: boolean; tasks: boolean; appointments: boolean; email: boolean };
}) {
  const router = useRouter();
  const timeZone = useSession().activeAccount?.timezone;
  const [tab, setTab] = React.useState<Tab>('all');
  const [pages, setPages] = React.useState<Record<string, { entries: HistoryEntry[]; cursor: string | null }>>({
    all: { entries: contact.history.data, cursor: contact.history.nextCursor },
  });
  const [loading, setLoading] = React.useState(false);
  const [composer, setComposer] = React.useState<ComposerKind | null>(null);

  // The header buttons and the keyboard shortcuts ask for a composer through this event.
  React.useEffect(() => {
    const onCompose = (e: Event) => {
      const kind = (e as CustomEvent<ComposerKind>).detail;
      setComposer(kind);
      document.getElementById('history-composer')?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('lc:compose', onCompose);
    return () => window.removeEventListener('lc:compose', onCompose);
  }, []);

  // The server's first page is for "all"; the record has been refreshed when it changes.
  React.useEffect(() => {
    setPages({ all: { entries: contact.history.data, cursor: contact.history.nextCursor } });
  }, [contact.history]);

  const current = TABS.find((t) => t.key === tab)!;
  const pageKey = tab === 'changes' ? 'all' : tab;

  async function fetchPage(key: string, before?: string) {
    setLoading(true);
    const type = key === 'all' ? undefined : key;
    const res = await loadHistory(accountId, contact.id, { type, before, limit: 30 });
    setLoading(false);
    if (!res.ok) return;
    setPages((p) => ({
      [key]: { entries: before ? [...(p[key]?.entries ?? []), ...res.data.data] : res.data.data, cursor: res.data.nextCursor },
      ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== key)),
    }));
  }

  React.useEffect(() => {
    if (!pages[pageKey]) void fetchPage(pageKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  const page = pages[pageKey];
  const entries = (page?.entries ?? []).filter((e) => (current.types ? current.types.includes(e.type) : true));
  const counts = contact.historyCounts;
  const tabCount = (t: (typeof TABS)[number]) =>
    t.types ? t.types.reduce((s, k) => s + (counts[k] ?? 0), 0) : Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>History</CardTitle>
        <span className="text-[11px] text-fg-subtle">N note · C call · T task · A appointment</span>
      </CardHeader>
      <CardBody>
        {contact.pinnedNotes.length > 0 && (
          <div className="mb-4 space-y-2">
            {contact.pinnedNotes.map((n) => (
              <PinnedNote key={n.id} accountId={accountId} contactId={contact.id} note={n} canEdit={can.edit} />
            ))}
          </div>
        )}

        <div id="history-composer">
          <Composer
            accountId={accountId}
            contact={contact}
            owners={owners}
            currentUserId={currentUserId}
            can={can}
            kind={composer}
            onKind={setComposer}
            onDone={() => router.refresh()}
          />
        </div>

        <div className="mt-5 flex flex-wrap gap-1 border-b border-border pb-2">
          {TABS.map((t) => {
            const n = tabCount(t);
            if (t.key !== 'all' && n === 0 && t.key !== 'note' && t.key !== 'call') return null;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
                  tab === t.key ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {t.label}
                {n > 0 && <span className="ml-1 tabular text-fg-subtle">{n}</span>}
              </button>
            );
          })}
        </div>

        {entries.length === 0 && !loading && (
          <p className="py-10 text-center text-[13px] text-fg-subtle">
            {tab === 'all' ? 'Nothing logged yet. Add a note or log a call above.' : `No ${current.label.toLowerCase()} yet.`}
          </p>
        )}

        <ol className="mt-4">
          {entries.map((e, i) => (
            <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
              {i < entries.length - 1 && <span aria-hidden className="absolute left-[13px] top-7 h-full w-px bg-border" />}
              <span className="z-10 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-border bg-surface text-fg-muted">
                {ICON[e.type] ?? '•'}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <p className="text-[13px] font-medium text-fg">{e.title}</p>
                  <time className="text-[11px] text-fg-subtle" dateTime={e.occurredAt}>
                    {formatDateTime(e.occurredAt, timeZone)}
                  </time>
                  {e.actor && <span className="text-[11px] text-fg-subtle">· {e.actor.name}</span>}
                  {e.pinned && (
                    <span className="text-[11px] text-brand-text">
                      <Pin size={10} className="inline" /> pinned
                    </span>
                  )}
                </div>
                <EntryDetail entry={e} accountId={accountId} timeZone={timeZone} />
                {e.body && e.type !== 'email' && <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-muted">{e.body}</p>}
                {e.type === 'note' && can.edit && <NoteControls accountId={accountId} contactId={contact.id} note={e} />}
              </div>
            </li>
          ))}
        </ol>

        {page?.cursor && (
          <div className="mt-2 text-center">
            <Button variant="ghost" size="sm" disabled={loading} onClick={() => fetchPage(pageKey, page.cursor!)}>
              {loading ? 'Loading…' : 'Show older'}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function EntryDetail({ entry, accountId, timeZone }: { entry: HistoryEntry; accountId: string; timeZone?: string }) {
  const m = (entry.metadata ?? {}) as Record<string, unknown>;
  switch (entry.type) {
    case 'call': {
      const bits = [
        m.direction === 'inbound' ? 'Inbound' : 'Outbound',
        typeof m.durationSeconds === 'number' ? duration(m.durationSeconds) : null,
        typeof m.outcome === 'string' ? String(m.outcome).replace(/_/g, ' ') : null,
      ].filter(Boolean);
      return <p className="mt-0.5 text-[12px] text-fg-subtle">{bits.join(' · ')}</p>;
    }
    case 'email':
      return (
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-fg-subtle">
          {entry.email ? (
            <>
              <Badge tone={entry.email.status === 'failed' || entry.email.status === 'bounced' ? 'danger' : entry.email.status === 'sent' || entry.email.status === 'delivered' ? 'success' : 'neutral'}>
                {entry.email.status}
              </Badge>
              {entry.email.openedAt && <Badge tone="brand">opened</Badge>}
              <span>to {entry.email.to.join(', ')}</span>
              <Link href={`/app/${accountId}/email`} className="text-brand-text hover:underline">
                open
              </Link>
            </>
          ) : (
            <span>message no longer available</span>
          )}
          {entry.body && <p className="w-full whitespace-pre-wrap text-[13px] text-fg-muted">{entry.body}</p>}
        </div>
      );
    case 'appointment':
      return typeof m.startsAt === 'string' ? <p className="mt-0.5 text-[12px] text-fg-subtle">{formatDateTime(m.startsAt, timeZone)}</p> : null;
    case 'field_change': {
      const changes = (m.changes as { field: string; from?: unknown; to?: unknown }[] | undefined) ?? [];
      return (
        <ul className="mt-0.5 space-y-0.5 text-[12px] text-fg-subtle">
          {changes.slice(0, 6).map((c) => (
            <li key={c.field}>
              <span className="text-fg-muted">{c.field}</span>: {brief(c.from)} → {brief(c.to)}
            </li>
          ))}
        </ul>
      );
    }
    default:
      return null;
  }
}

function brief(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map(brief).join(', ') : '—';
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).filter(Boolean).map(brief).join(' ') || '—';
  return String(v);
}

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function PinnedNote({ accountId, contactId, note, canEdit }: { accountId: string; contactId: string; note: Activity; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <div className="flex items-start gap-2 rounded-lg border border-brand-border bg-brand-subtle px-3 py-2">
      <Pin size={13} className="mt-0.5 shrink-0 text-brand-text" />
      <p className="flex-1 whitespace-pre-wrap text-[13px] text-fg">{note.body ?? note.title}</p>
      {canEdit && (
        <button
          disabled={pending}
          aria-label="Unpin"
          className="text-fg-subtle hover:text-fg"
          onClick={() => startTransition(async () => { await updateNote(accountId, contactId, note.id, { pinned: false }); router.refresh(); })}
        >
          <PinOff size={13} />
        </button>
      )}
    </div>
  );
}

function NoteControls({ accountId, contactId, note }: { accountId: string; contactId: string; note: HistoryEntry }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState(false);
  const [body, setBody] = React.useState(note.body ?? '');

  if (editing) {
    return (
      <div className="mt-1.5 space-y-1.5">
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex gap-1.5">
          <Button size="sm" disabled={pending} onClick={() => startTransition(async () => { await updateNote(accountId, contactId, note.id, { body }); setEditing(false); router.refresh(); })}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1 flex gap-2 text-[11px] text-fg-subtle">
      <button onClick={() => setEditing(true)} className="hover:text-fg">Edit</button>
      <button
        disabled={pending}
        className="hover:text-fg"
        onClick={() => startTransition(async () => { await updateNote(accountId, contactId, note.id, { pinned: !note.pinned }); router.refresh(); })}
      >
        {note.pinned ? 'Unpin' : 'Pin'}
      </button>
      <button
        disabled={pending}
        className="hover:text-danger"
        onClick={() => { if (window.confirm('Delete this note?')) startTransition(async () => { await deleteNote(accountId, contactId, note.id); router.refresh(); }); }}
      >
        Delete
      </button>
    </div>
  );
}

// ── Composer ────────────────────────────────────────────────────────────────

function Composer({
  accountId,
  contact,
  owners,
  currentUserId,
  can,
  kind,
  onKind,
  onDone,
}: {
  accountId: string;
  contact: ContactDetail;
  owners: { id: string; name: string }[];
  currentUserId: string;
  can: { edit: boolean; tasks: boolean; appointments: boolean };
  kind: ComposerKind | null;
  onKind: (k: ComposerKind | null) => void;
  onDone: () => void;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const [body, setBody] = React.useState('');
  const [pin, setPin] = React.useState(false);
  const [direction, setDirection] = React.useState<'outbound' | 'inbound'>('outbound');
  const [minutes, setMinutes] = React.useState('');
  const [outcome, setOutcome] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [dueAt, setDueAt] = React.useState('');
  const [assigneeId, setAssigneeId] = React.useState(currentUserId);
  const [priority, setPriority] = React.useState<'low' | 'normal' | 'high'>('normal');
  const [startsAt, setStartsAt] = React.useState('');
  const [location, setLocation] = React.useState('');

  const available: { key: ComposerKind; label: string; allowed: boolean }[] = [
    { key: 'note', label: 'Note', allowed: can.edit },
    { key: 'call', label: 'Log call', allowed: can.edit },
    { key: 'task', label: 'Task', allowed: can.tasks },
    { key: 'appointment', label: 'Appointment', allowed: can.appointments },
  ];
  const active = kind ?? available.find((a) => a.allowed)?.key ?? null;
  if (!active) return null;

  function reset() {
    setBody(''); setPin(false); setMinutes(''); setOutcome(''); setTitle(''); setDueAt(''); setStartsAt(''); setLocation(''); setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      let res: { ok: true } | { ok: false; error: string };
      if (active === 'note') {
        if (!body.trim()) return setError('Write something first.');
        res = await logActivity(accountId, contact.id, { type: 'note', body: body.trim(), pinned: pin });
      } else if (active === 'call') {
        const seconds = minutes ? Math.round(Number(minutes) * 60) : undefined;
        res = await logActivity(accountId, contact.id, {
          type: 'call',
          body: body.trim() || undefined,
          metadata: { direction, ...(seconds !== undefined && Number.isFinite(seconds) ? { durationSeconds: seconds } : {}), ...(outcome ? { outcome } : {}) },
        });
      } else if (active === 'task') {
        if (!title.trim()) return setError('A task needs a title.');
        res = await createTask(accountId, { title: title.trim(), description: body.trim() || undefined, contactId: contact.id, assigneeId, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined, priority });
      } else {
        if (!title.trim() || !startsAt) return setError('An appointment needs a title and a time.');
        res = await createAppointment(accountId, { contactId: contact.id, title: title.trim(), startsAt: new Date(startsAt).toISOString(), userId: assigneeId, location: location.trim() || undefined, notes: body.trim() || undefined });
      }
      if (res.ok) {
        reset();
        onDone();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-1">
      <div className="flex flex-wrap gap-1 px-1 pt-1">
        {available.filter((a) => a.allowed).map((a) => (
          <button
            key={a.key}
            onClick={() => onKind(a.key)}
            className={cn('rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors', active === a.key ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg')}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="space-y-2 p-1 pt-2">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[13px] text-danger">{error}</p>
          </div>
        )}

        {active === 'call' && (
          <div className="grid grid-cols-3 gap-2">
            <Select value={direction} onChange={(e) => setDirection(e.target.value as 'outbound' | 'inbound')} aria-label="Direction">
              <option value="outbound">Outbound</option>
              <option value="inbound">Inbound</option>
            </Select>
            <Input value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Minutes" type="number" min="0" step="0.5" aria-label="Duration in minutes" />
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">
              <option value="">Outcome…</option>
              <option value="connected">Connected</option>
              <option value="voicemail">Voicemail</option>
              <option value="no_answer">No answer</option>
              <option value="busy">Busy</option>
              <option value="wrong_number">Wrong number</option>
              <option value="callback">Callback requested</option>
            </Select>
          </div>
        )}

        {(active === 'task' || active === 'appointment') && (
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={active === 'task' ? 'What needs doing' : 'What the appointment is'} aria-label="Title" autoFocus />
            </div>
            {active === 'task' ? (
              <>
                <div>
                  <Label htmlFor="t-due">Due</Label>
                  <Input id="t-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="t-priority">Priority</Label>
                  <Select id="t-priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label htmlFor="a-start">When</Label>
                  <Input id="a-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="a-where">Where</Label>
                  <Input id="a-where" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Address, or phone" />
                </div>
              </>
            )}
            <div className="col-span-2">
              <Label htmlFor="t-who">{active === 'task' ? 'Assigned to' : 'With'}</Label>
              <Select id="t-who" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}

        <Textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={active === 'note' ? 'Add a note…' : active === 'call' ? 'What happened on the call?' : 'Details (optional)'}
        />

        <div className="flex items-center justify-between gap-2">
          {active === 'note' ? (
            <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
              <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} className="accent-brand" /> Pin above the history
            </label>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>
              Clear
            </Button>
            <Button size="sm" onClick={submit} disabled={pending}>
              {pending ? 'Saving…' : active === 'task' ? 'Create task' : active === 'appointment' ? 'Schedule' : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {(contact.openTasks.length > 0 || contact.upcomingAppointments.length > 0) && (
        <OpenItems accountId={accountId} contact={contact} can={can} onDone={onDone} />
      )}
    </div>
  );
}

/** Open tasks and upcoming appointments, right under the composer where they are acted on. */
function OpenItems({ accountId, contact, can, onDone }: { accountId: string; contact: ContactDetail; can: { tasks: boolean; appointments: boolean }; onDone: () => void }) {
  const timeZone = useSession().activeAccount?.timezone;
  const [pending, startTransition] = React.useTransition();
  return (
    <div className="mx-1 mb-1 space-y-1 rounded-md border border-border bg-surface px-3 py-2">
      {contact.openTasks.map((t) => (
        <div key={t.id} className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            aria-label={`Complete ${t.title}`}
            disabled={!can.tasks || pending}
            onChange={() => startTransition(async () => { await updateTask(accountId, t.id, { status: 'done' }, contact.id); onDone(); })}
            className="accent-brand"
          />
          <span className="flex-1 text-fg">{t.title}</span>
          {t.dueAt && <span className={cn('tabular text-[11px]', new Date(t.dueAt) < new Date() ? 'text-danger' : 'text-fg-subtle')}>{formatDateTime(t.dueAt, timeZone)}</span>}
          {t.priority === 'high' && <Badge tone="warning">High</Badge>}
        </div>
      ))}
      {contact.upcomingAppointments.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-[13px]">
          <CalendarClock size={13} className="text-fg-subtle" />
          <span className="flex-1 text-fg">{a.title}</span>
          <span className="tabular text-[11px] text-fg-subtle">{formatDateTime(a.startsAt, timeZone)}</span>
          {can.appointments && (
            <Select
              defaultValue=""
              aria-label="Record outcome"
              className="h-7 w-auto text-[12px]"
              disabled={pending}
              onChange={(e) => {
                const outcome = e.target.value as 'held' | 'no_show' | 'cancelled';
                if (outcome) startTransition(async () => { await updateAppointment(accountId, a.id, { outcome }, contact.id); onDone(); });
              }}
            >
              <option value="">Outcome…</option>
              <option value="held">Held</option>
              <option value="no_show">No-show</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          )}
        </div>
      ))}
    </div>
  );
}

export { Trash2 };
