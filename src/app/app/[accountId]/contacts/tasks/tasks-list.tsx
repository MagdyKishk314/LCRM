'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Plus, Search, Trash2, X } from 'lucide-react';
import type { Task } from '@/shared';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { searchContacts } from '@/lib/actions/contacts';
import { createTask, deleteTask, updateTask } from '@/lib/actions/tasks';
import type { Facets } from '@/lib/contacts/facets';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

export interface TaskRow extends Task {
  contact: { id: string; name: string; phone?: string } | null;
}

type Tab = 'mine' | 'all' | 'done';

export function TasksList({
  accountId,
  mine,
  all,
  done,
  facets,
  currentUserId,
  canManage,
}: {
  accountId: string;
  mine: TaskRow[];
  all: TaskRow[];
  done: TaskRow[];
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

  const rows = tab === 'mine' ? mine : tab === 'all' ? all : done;
  const now = Date.now();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const groups: { label: string; rows: TaskRow[] }[] =
    tab === 'done'
      ? [{ label: 'Recently completed', rows }]
      : [
          { label: 'Overdue', rows: rows.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now) },
          { label: 'Today', rows: rows.filter((t) => t.dueAt && new Date(t.dueAt).getTime() >= now && new Date(t.dueAt) <= endOfToday) },
          { label: 'Upcoming', rows: rows.filter((t) => t.dueAt && new Date(t.dueAt) > endOfToday) },
          { label: 'No due date', rows: rows.filter((t) => !t.dueAt) },
        ].filter((g) => g.rows.length > 0);

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
        {(['mine', 'all', 'done'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn('rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors', tab === t ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg')}
          >
            {t === 'mine' ? `Mine (${mine.length})` : t === 'all' ? `Everyone (${all.length})` : 'Done'}
          </button>
        ))}
        {canManage && (
          <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}>
            <Plus size={13} /> New task
          </Button>
        )}
      </div>

      {adding && <NewTaskForm accountId={accountId} facets={facets} currentUserId={currentUserId} onClose={() => setAdding(false)} />}

      {groups.length === 0 && (
        <div className="rounded-card border border-border bg-surface px-4 py-14 text-center">
          <p className="text-sm font-medium text-fg">{tab === 'done' ? 'Nothing completed yet' : 'Nothing to do'}</p>
          <p className="mt-1 text-[13px] text-fg-muted">Tasks are created here or from a contact&apos;s page.</p>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.label}>
          <p className={cn('mb-1.5 text-[11px] font-semibold uppercase tracking-wider', g.label === 'Overdue' ? 'text-danger' : 'text-fg-subtle')}>{g.label}</p>
          <div className="divide-y divide-border rounded-card border border-border bg-surface">
            {g.rows.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={t.status === 'done'}
                  disabled={!canManage || pending}
                  aria-label={t.status === 'done' ? `Reopen ${t.title}` : `Complete ${t.title}`}
                  onChange={() => act(() => updateTask(accountId, t.id, { status: t.status === 'done' ? 'open' : 'done' }, t.contactId))}
                  className="accent-brand"
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-[13px] font-medium', t.status === 'done' ? 'text-fg-subtle line-through' : 'text-fg')}>{t.title}</p>
                  <p className="flex flex-wrap gap-x-2 text-[12px] text-fg-subtle">
                    {t.contact && (
                      <Link href={`/app/${accountId}/contacts/${t.contact.id}`} className="text-brand-text hover:underline">
                        {t.contact.name}
                      </Link>
                    )}
                    {t.assigneeId && tab !== 'mine' && <span>{ownerName.get(t.assigneeId) ?? 'someone'}</span>}
                    {t.description && <span className="truncate">{t.description}</span>}
                  </p>
                </div>
                {t.priority === 'high' && <Badge tone="warning">High</Badge>}
                {t.priority === 'low' && <Badge>Low</Badge>}
                {t.dueAt && (
                  <span className={cn('tabular text-[12px]', t.status === 'open' && new Date(t.dueAt).getTime() < now ? 'text-danger' : 'text-fg-subtle')}>
                    {formatDateTime(t.dueAt, timeZone)}
                  </span>
                )}
                {canManage && (
                  <button onClick={() => { if (window.confirm('Delete this task?')) act(() => deleteTask(accountId, t.id, t.contactId)); }} disabled={pending} aria-label="Delete task" className="text-fg-subtle hover:text-danger">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewTaskForm({ accountId, facets, currentUserId, onClose }: { accountId: string; facets: Facets; currentUserId: string; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [dueAt, setDueAt] = React.useState('');
  const [assigneeId, setAssigneeId] = React.useState(currentUserId);
  const [priority, setPriority] = React.useState<'low' | 'normal' | 'high'>('normal');
  const [contact, setContact] = React.useState<{ id: string; name: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createTask(accountId, {
        title: title.trim(),
        description: description.trim() || undefined,
        contactId: contact?.id,
        assigneeId,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        priority,
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
        <h3 className="text-sm font-semibold text-fg">New task</h3>
        <button type="button" onClick={onClose} aria-label="Cancel" className="text-fg-subtle hover:text-fg">
          <X size={15} />
        </button>
      </div>
      {error && <p className="mb-3 text-[13px] text-danger">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="nt-title">What needs doing</Label>
          <Input id="nt-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        </div>
        <div className="sm:col-span-2">
          <Label>About</Label>
          <ContactPicker accountId={accountId} value={contact} onChange={setContact} />
        </div>
        <div>
          <Label htmlFor="nt-due">Due</Label>
          <Input id="nt-due" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="nt-priority">Priority</Label>
          <Select id="nt-priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="nt-who">Assigned to</Label>
          <Select id="nt-who" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            {facets.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="nt-desc">Details</Label>
          <Textarea id="nt-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm" disabled={pending || !title.trim()}>{pending ? 'Creating…' : 'Create task'}</Button>
      </div>
    </form>
  );
}

/** Find a contact by name or number. Shared by the tasks and appointments forms. */
export function ContactPicker({ accountId, value, onChange, required }: { accountId: string; value: { id: string; name: string } | null; onChange: (c: { id: string; name: string } | null) => void; required?: boolean }) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<{ id: string; name: string; phone?: string }[]>([]);

  React.useEffect(() => {
    if (query.trim().length < 2) return setResults([]);
    const timer = setTimeout(async () => {
      const res = await searchContacts(accountId, query.trim());
      if (res.ok) setResults(res.data.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, phone: c.phone })));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, accountId]);

  if (value) {
    return (
      <div className="flex h-9 items-center justify-between rounded-lg border border-border bg-surface-2 px-3 text-[13px]">
        <span className="text-fg">{value.name}</span>
        <button type="button" onClick={() => onChange(null)} aria-label="Clear contact" className="text-fg-subtle hover:text-fg">
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={required ? 'Find a contact…' : 'Find a contact (optional)…'} className="pl-8" />
      {results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full divide-y divide-border rounded-lg border border-border bg-surface shadow-lg">
          {results.map((r) => (
            <button key={r.id} type="button" onClick={() => { onChange({ id: r.id, name: r.name }); setQuery(''); setResults([]); }} className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-surface-2">
              <span className="text-fg">{r.name}</span>
              <span className="tabular text-fg-subtle">{r.phone ?? ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
