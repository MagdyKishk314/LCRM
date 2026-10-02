'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Copy, ListFilter, Lock, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { countContactFilterConditions, describeContactFilter, type ContactFilter, type ContactList } from '@landcaller/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { createList, deleteList, duplicateList, updateList } from '@/lib/actions/contacts';
import type { Facets } from '@/lib/contacts/facets';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { FilterPanel } from '../filter-panel';

/**
 * CNT-09 / CNT-30 / CNT-34 — lists.
 *
 * A smart list is a saved filter, built and edited with the same panel the contacts table
 * uses, and described on its card in words. A static list is a set that bulk actions and
 * imports add to.
 */
export function ListsManager({
  accountId,
  lists,
  facets,
  canManage,
}: {
  accountId: string;
  lists: ContactList[];
  facets: Facets;
  canManage: boolean;
}) {
  const router = useRouter();
  const timeZone = useSession().activeAccount?.timezone;
  const [editing, setEditing] = React.useState<ContactList | 'new' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const labels = {
    owners: Object.fromEntries(facets.owners.map((o) => [o.id, o.name])),
    fields: Object.fromEntries(facets.fields.map((f) => [f.key, f.label])),
  };

  function act(task: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await task();
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  function onDelete(list: ContactList) {
    if (!window.confirm(`Delete the list "${list.name}"? The contacts in it are not deleted.`)) return;
    act(() => deleteList(accountId, list.id));
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] text-danger">{error}</p>
        </div>
      )}

      {canManage && (
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus size={13} /> New list
        </Button>
      )}

      {editing && (
        <ListEditor accountId={accountId} list={editing === 'new' ? null : editing} facets={facets} onClose={() => setEditing(null)} />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {lists.map((list) => {
          const filter = (list.filter ?? {}) as ContactFilter;
          const clauses = list.type === 'smart' ? describeContactFilter(filter, labels) : [];
          const isDnc = filter.dnc === true;
          return (
            <Card key={list.id} className="transition-shadow hover:shadow-sm">
              <CardBody>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Link href={`/app/${accountId}/contacts?listId=${list.id}`} className="text-sm font-semibold text-fg hover:text-brand-text hover:underline">
                    {list.name}
                  </Link>
                  <Badge tone={list.type === 'smart' ? 'brand' : 'neutral'}>
                    {list.type === 'smart' ? (
                      <>
                        <ListFilter size={10} /> Smart
                      </>
                    ) : (
                      'Static'
                    )}
                  </Badge>
                </div>

                {list.description && <p className="mb-2 text-[13px] leading-relaxed text-fg-muted">{list.description}</p>}

                {clauses.length > 0 && (
                  <p className="mb-3 text-[12px] leading-relaxed text-fg-subtle">
                    {clauses.map((c, i) => (
                      <span key={i}>
                        {i > 0 && ' · '}
                        {c}
                      </span>
                    ))}
                  </p>
                )}
                {list.type === 'static' && <p className="mb-3 text-[12px] text-fg-subtle">Added to from the contacts table and imports.</p>}

                <div className="flex items-center gap-3 text-[12px] text-fg-subtle">
                  <span className="flex items-center gap-1">
                    <Users size={12} />
                    <span className="tabular">{list.memberCount.toLocaleString()}</span>
                  </span>
                  <span>changed {formatDate(list.updatedAt, timeZone)}</span>
                  {isDnc && (
                    <span className="flex items-center gap-1 font-medium text-danger">
                      <Lock size={12} /> Never dial
                    </span>
                  )}
                  {canManage && (
                    <span className="ml-auto flex items-center gap-2">
                      <button onClick={() => setEditing(list)} aria-label={`Edit ${list.name}`} className="text-fg-subtle transition-colors hover:text-fg">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => act(() => duplicateList(accountId, list.id))} disabled={pending} aria-label={`Duplicate ${list.name}`} className="text-fg-subtle transition-colors hover:text-fg disabled:opacity-50">
                        <Copy size={13} />
                      </button>
                      <button onClick={() => onDelete(list)} disabled={pending} aria-label={`Delete ${list.name}`} className="text-fg-subtle transition-colors hover:text-danger disabled:opacity-50">
                        <Trash2 size={13} />
                      </button>
                    </span>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}

        {lists.length === 0 && (
          <div className="col-span-full rounded-card border border-border bg-surface px-4 py-14 text-center">
            <p className="text-sm font-medium text-fg">No lists yet</p>
            <p className="mt-1 text-[13px] text-fg-muted">Smart lists re-evaluate as contacts change; static lists hold a fixed set.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ListEditor({ accountId, list, facets, onClose }: { accountId: string; list: ContactList | null; facets: Facets; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = React.useState(list?.name ?? '');
  const [description, setDescription] = React.useState(list?.description ?? '');
  const [type, setType] = React.useState<'smart' | 'static'>(list?.type ?? 'smart');
  const [filter, setFilter] = React.useState<ContactFilter>((list?.filter as ContactFilter) ?? {});
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (type === 'smart' && countContactFilterConditions(filter) === 0) {
      return setError('A smart list needs at least one condition, or it would match every contact.');
    }
    startTransition(async () => {
      const res = list
        ? await updateList(accountId, list.id, { name: name.trim(), description: description.trim() || undefined, ...(list.type === 'smart' ? { filter } : {}) })
        : await createList(accountId, { name: name.trim(), description: description.trim() || undefined, type, filter: type === 'smart' ? filter : undefined });
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
        <h3 className="text-sm font-semibold text-fg">{list ? `Edit ${list.name}` : 'New list'}</h3>
        <button type="button" onClick={onClose} aria-label="Cancel" className="text-fg-subtle transition-colors hover:text-fg">
          <X size={15} />
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] text-danger">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor="l-name">Name</Label>
          <Input id="l-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Costilla County 5+ acres" autoFocus />
        </div>
        <div>
          <Label htmlFor="l-type">Type</Label>
          <Select id="l-type" value={type} onChange={(e) => setType(e.target.value as 'smart' | 'static')} disabled={Boolean(list)}>
            <option value="smart">Smart</option>
            <option value="static">Static</option>
          </Select>
        </div>
      </div>

      <div className="mt-3">
        <Label htmlFor="l-desc">Description</Label>
        <Input id="l-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      {type === 'smart' ? (
        <div className="mt-4 border-t border-border pt-4">
          <FilterPanel filter={filter} onChange={setFilter} facets={facets} showList={false} />
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-fg-subtle">A static list starts empty. Add contacts to it from the contacts table or an import.</p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          {pending ? 'Saving…' : list ? 'Save list' : 'Create list'}
        </Button>
      </div>
    </form>
  );
}
