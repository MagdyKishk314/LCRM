'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bookmark, Columns3, Download, Filter, Search, SlidersHorizontal, Upload, X } from 'lucide-react';
import {
  CONTACT_STATUS_LABEL,
  CONTACT_STATUSES,
  contactFilterToParams,
  countContactFilterConditions,
  describeContactFilter,
  type ContactFilter,
  type ContactList,
  type ContactStatus,
} from '@landcaller/shared';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { createList } from '@/lib/actions/contacts';
import type { Facets } from '@/lib/contacts/facets';
import { COLUMNS } from './columns';
import { ExportDialog } from './export-dialog';
import { FilterPanel } from './filter-panel';
import { NewContact } from './new-contact';

export interface ContactPermissions {
  create: boolean;
  update: boolean;
  delete: boolean;
  export: boolean;
  import: boolean;
  manageLists: boolean;
}

/**
 * CNT-02 / CNT-29 / CNT-30 — search, the quick filters, the full panel, and the things
 * done to the current view: save it as a list, export it, choose columns.
 *
 * Every control writes to the URL rather than to local state, so the server re-fetches a
 * genuinely filtered page. This is what lets the table work against 12,000 contacts
 * instead of the 25 that happen to be loaded.
 */
export function ContactsToolbar({
  accountId,
  facets,
  lists,
  filter,
  total,
  can,
  columns,
  onColumns,
}: {
  accountId: string;
  facets: Facets;
  lists: ContactList[];
  filter: ContactFilter;
  total: number;
  can: ContactPermissions;
  columns: string[];
  onColumns: (keys: string[]) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = React.useState(filter.search ?? '');
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ContactFilter>(filter);
  const [exporting, setExporting] = React.useState(false);
  const [columnsOpen, setColumnsOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [listName, setListName] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => setDraft(filter), [filter]);

  /** Replace the URL's filter with this one, keeping sort and dropping the page number. */
  function apply(next: ContactFilter) {
    const query = new URLSearchParams(contactFilterToParams(next));
    const sort = params.get('sort');
    if (sort) query.set('sort', sort);
    startTransition(() => router.push(`${pathname}?${query}`));
  }

  // Debounced so typing does not fire a server round trip per keystroke.
  React.useEffect(() => {
    const current = filter.search ?? '';
    if (search === current) return;
    const timer = setTimeout(() => apply({ ...filter, search: search || undefined }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const conditions = countContactFilterConditions({ ...filter, search: undefined });
  const activeList = filter.listId ? lists.find((l) => l.id === filter.listId) : undefined;
  const described = describeContactFilter(filter, {
    owners: Object.fromEntries(facets.owners.map((o) => [o.id, o.name])),
    lists: Object.fromEntries(lists.map((l) => [l.id, l.name])),
    fields: Object.fromEntries(facets.fields.map((f) => [f.key, f.label])),
  });

  function saveAsList() {
    const name = listName.trim();
    if (!name) return;
    startTransition(async () => {
      const { listId: _l, ...conditionsOnly } = filter;
      const res = await createList(accountId, { name, type: 'smart', filter: conditionsOnly });
      if (res.ok) {
        setSaving(false);
        setListName('');
        apply({ listId: res.data.id });
      } else {
        window.alert(res.error);
      }
    });
  }

  return (
    <div className="px-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, phone or APN…" className="pl-8" />
        </div>

        <Select value={filter.status?.length === 1 ? filter.status[0] : ''} onChange={(e) => apply({ ...filter, status: e.target.value ? [e.target.value as ContactStatus] : undefined })} className="w-auto" aria-label="Status">
          <option value="">{filter.status && filter.status.length > 1 ? `${filter.status.length} statuses` : 'All statuses'}</option>
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CONTACT_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>

        {lists.length > 0 && (
          <Select value={filter.listId ?? ''} onChange={(e) => apply({ ...filter, listId: e.target.value || undefined })} className="w-auto" aria-label="List">
            <option value="">All contacts</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}

        <Button variant={panelOpen || conditions > 0 ? 'secondary' : 'outline'} size="sm" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
          <SlidersHorizontal size={13} /> Filters{conditions > 0 && ` (${conditions})`}
        </Button>

        {(conditions > 0 || filter.search) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); apply({}); }}>
            <X size={13} /> Clear
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setColumnsOpen((o) => !o)} aria-expanded={columnsOpen} title="Choose columns">
            <Columns3 size={13} />
          </Button>
          {can.manageLists && conditions > 0 && !activeList && (
            <Button variant="outline" size="sm" onClick={() => setSaving((s) => !s)} title="Save this filter as a smart list">
              <Bookmark size={13} /> Save as list
            </Button>
          )}
          {can.import && (
            <Link href={`/app/${accountId}/contacts/import`}>
              <Button variant="outline" size="sm">
                <Upload size={13} /> Import
              </Button>
            </Link>
          )}
          {can.export && (
            <Button variant="outline" size="sm" onClick={() => setExporting(true)}>
              <Download size={13} /> Export
            </Button>
          )}
          {can.create && <NewContact accountId={accountId} facets={facets} />}
        </div>
      </div>

      {saving && (
        <form
          onSubmit={(e) => { e.preventDefault(); saveAsList(); }}
          className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2"
        >
          <span className="text-[13px] text-fg-muted">Save the current filter as a smart list named</span>
          <Input value={listName} onChange={(e) => setListName(e.target.value)} placeholder="Costilla 5+ acres" className="h-8 w-56" autoFocus />
          <Button type="submit" size="sm" disabled={pending || !listName.trim()}>Save</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSaving(false)}>Cancel</Button>
        </form>
      )}

      {columnsOpen && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-2 px-3 py-2">
          {[...COLUMNS, ...facets.fields.map((f) => ({ key: `cf.${f.key}`, label: f.label }))].map((c) => (
            <label key={c.key} className="flex items-center gap-1.5 text-[12px] text-fg">
              <input
                type="checkbox"
                checked={columns.includes(c.key)}
                disabled={c.key === 'name'}
                onChange={() => onColumns(columns.includes(c.key) ? columns.filter((k) => k !== c.key) : [...columns, c.key])}
                className="accent-brand"
              />
              {c.label}
            </label>
          ))}
        </div>
      )}

      {panelOpen && (
        <div className="mb-3 rounded-card border border-border bg-surface p-4">
          <FilterPanel filter={draft} onChange={setDraft} facets={facets} lists={lists} />
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={() => setDraft({ search: filter.search })}>Reset</Button>
            <Button size="sm" onClick={() => { apply({ ...draft, search: search || undefined }); setPanelOpen(false); }} disabled={pending}>
              Apply filters
            </Button>
          </div>
        </div>
      )}

      <p className="mb-3 flex flex-wrap items-center gap-x-1.5 text-[13px] text-fg-muted">
        <Filter size={13} />
        <span className="tabular">{total.toLocaleString()}</span> contact{total === 1 ? '' : 's'}
        {activeList && <span>in {activeList.name}</span>}
        {described.length > 0 && <span className="text-fg-subtle">· {described.join(' · ')}</span>}
        {pending && <span className="text-fg-subtle">· updating…</span>}
      </p>

      {exporting && <ExportDialog accountId={accountId} filter={filter} total={total} facets={facets} onClose={() => setExporting(false)} />}
    </div>
  );
}
