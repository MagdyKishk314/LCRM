'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowDown, ArrowUp, Pin, X } from 'lucide-react';
import {
  CONTACT_STATUS_LABEL,
  CONTACT_STATUSES,
  CUSTOM_FIELD_PREFIX,
  isUsPhone,
  type Contact,
  type ContactFilter,
  type ContactList,
} from '@landcaller/shared';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { bulkUpdate, type BulkAction } from '@/lib/actions/contacts';
import type { Facets } from '@/lib/contacts/facets';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { COLUMNS, loadColumns, saveColumns, type Column } from './columns';
import { ContactsToolbar, type ContactPermissions } from './contacts-toolbar';
import { ExportDialog } from './export-dialog';

const STATUS_TONE: Record<Contact['status'], 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  new: 'info',
  contacted: 'neutral',
  qualified: 'success',
  unqualified: 'warning',
  do_not_call: 'danger',
};

interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * The contacts table (CNT-01, CNT-03, CNT-31 → CNT-33): sortable headers, chosen columns,
 * selection with "all matching", and every bulk action. The toolbar is rendered from here
 * so the column choice is one piece of state shared between them.
 */
export function ContactsTable({
  accountId,
  result,
  filter,
  sort,
  lists,
  facets,
  can,
}: {
  accountId: string;
  result: Paginated<Contact>;
  filter: ContactFilter;
  sort: string | undefined;
  lists: ContactList[];
  facets: Facets;
  can: ContactPermissions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Dates render in the sub-account's market timezone, identically on server and client.
  const timeZone = useSession().activeAccount?.timezone;

  const [columnKeys, setColumnKeys] = React.useState<string[]>(() => COLUMNS.filter((c) => ['name', 'status', 'phone', 'parcel', 'acres', 'tags', 'lastActivity'].includes(c.key)).map((c) => c.key));
  React.useEffect(() => setColumnKeys(loadColumns(accountId)), [accountId]);
  const chooseColumns = (keys: string[]) => {
    setColumnKeys(keys);
    saveColumns(accountId, keys);
  };

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  /** True when the user escalated the selection to every contact matching the filter. */
  const [selectAllMatching, setSelectAllMatching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [tagPrompt, setTagPrompt] = React.useState<'tag' | 'untag' | 'setSource' | null>(null);
  const [tagValue, setTagValue] = React.useState('');
  const [pending, startTransition] = React.useTransition();

  const rows = result.data;
  const allOnPage = rows.length > 0 && rows.every((c) => selected.has(c.id));
  const ownerName = React.useMemo(() => new Map(facets.owners.map((o) => [o.id, o.name])), [facets.owners]);

  const allColumns: Column[] = React.useMemo(
    () => [
      ...COLUMNS,
      ...facets.fields.map<Column>((f) => ({
        key: `${CUSTOM_FIELD_PREFIX}${f.key}`,
        label: f.label,
        align: f.type === 'number' || f.type === 'currency' ? 'right' : 'left',
        cell: (c) => {
          const v = c.customFields?.[f.key];
          if (v === undefined || v === null || v === '') return '';
          if (f.type === 'checkbox') return v ? 'Yes' : 'No';
          if (f.type === 'currency') return `$${Number(v).toLocaleString()}`;
          return Array.isArray(v) ? v.join(', ') : String(v);
        },
      })),
    ],
    [facets.fields],
  );
  const visible = columnKeys.map((k) => allColumns.find((c) => c.key === k)).filter((c): c is Column => Boolean(c));

  // A new page or filter makes the old selection meaningless. Compared by value: `filter`
  // is a fresh object on every render, so its identity says nothing about whether it changed.
  const filterKey = JSON.stringify(filter);
  React.useEffect(() => {
    setSelected(new Set());
    setSelectAllMatching(false);
  }, [result.page, filterKey]);

  function toggleAll() {
    const next = new Set(selected);
    if (allOnPage) {
      rows.forEach((c) => next.delete(c.id));
      setSelectAllMatching(false);
    } else {
      rows.forEach((c) => next.add(c.id));
    }
    setSelected(next);
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      setSelectAllMatching(false);
    } else {
      next.add(id);
    }
    setSelected(next);
  }

  function navigate(mutate: (q: URLSearchParams) => void) {
    const query = new URLSearchParams(params.toString());
    mutate(query);
    startTransition(() => router.push(`${pathname}?${query}`));
  }

  function sortBy(field: string) {
    const current = sort ?? '-createdAt';
    const next = current === field ? `-${field}` : field;
    navigate((q) => {
      q.set('sort', next);
      q.delete('page');
    });
  }

  const affected = selectAllMatching ? result.total : selected.size;

  function runBulk(action: BulkAction, value?: string) {
    setError(null);

    if (action === 'delete') {
      const ok = window.confirm(
        `Delete ${affected.toLocaleString()} contact${affected === 1 ? '' : 's'}? ` +
          'Their timelines and opportunities are deleted with them. This cannot be undone.',
      );
      if (!ok) return;
    }

    startTransition(async () => {
      // Sending the filter rather than 12,000 ids is what makes "select all matching" work.
      // `expectedCount` lets the server reject the delete if the set changed since render.
      const res = await bulkUpdate(accountId, {
        action,
        value,
        ...(selectAllMatching ? { filter, expectedCount: result.total } : { ids: [...selected] }),
      });

      if (res.ok) {
        setSelected(new Set());
        setSelectAllMatching(false);
        setTagPrompt(null);
        setTagValue('');
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  const sortField = sort?.replace(/^-/, '');
  const sortDesc = sort?.startsWith('-') ?? true;

  return (
    <>
      <ContactsToolbar accountId={accountId} facets={facets} lists={lists} filter={filter} total={result.total} can={can} columns={columnKeys} onColumns={chooseColumns} />

      <div className="px-6">
        {error && (
          <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5">
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[13px] text-danger">{error}</p>
          </div>
        )}

        {selected.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand-border bg-brand-subtle px-3 py-2">
            <span className="text-[13px] font-medium text-brand-text">{affected.toLocaleString()} selected</span>

            {/* Selecting a page of 25 out of 4,000 matches is rarely what the user means. */}
            {allOnPage && !selectAllMatching && result.total > rows.length && (
              <button onClick={() => setSelectAllMatching(true)} className="text-[13px] font-medium text-brand-text underline hover:no-underline">
                Select all {result.total.toLocaleString()} matching
              </button>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {can.update && (
                <>
                  <Select defaultValue="" disabled={pending} onChange={(e) => { if (e.target.value) runBulk('status', e.target.value); e.target.value = ''; }} className="h-8 w-auto text-[13px]" aria-label="Set status">
                    <option value="">Set status…</option>
                    {CONTACT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {CONTACT_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </Select>

                  <Select defaultValue="" disabled={pending} onChange={(e) => { if (e.target.value) runBulk('assignOwner', e.target.value); e.target.value = ''; }} className="h-8 w-auto text-[13px]" aria-label="Assign owner">
                    <option value="">Assign to…</option>
                    <option value="none">Nobody</option>
                    {facets.owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>

                  <Button variant="outline" size="sm" disabled={pending} onClick={() => setTagPrompt('tag')}>Add tag</Button>
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => setTagPrompt('untag')}>Remove tag</Button>
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => setTagPrompt('setSource')}>Set source</Button>

                  <Select defaultValue="" disabled={pending} onChange={(e) => { if (e.target.value) runBulk('dnc', e.target.value); e.target.value = ''; }} className="h-8 w-auto text-[13px]" aria-label="Do not call">
                    <option value="">DNC…</option>
                    <option value="true">Mark do not call</option>
                    <option value="false">Clear do not call</option>
                  </Select>

                  {lists.some((l) => l.type === 'static') && (
                    <Select defaultValue="" disabled={pending} onChange={(e) => { const [action, id] = e.target.value.split(':'); if (id) runBulk(action as BulkAction, id); e.target.value = ''; }} className="h-8 w-auto text-[13px]" aria-label="Lists">
                      <option value="">Lists…</option>
                      <optgroup label="Add to">
                        {lists.filter((l) => l.type === 'static').map((l) => (
                          <option key={`add-${l.id}`} value={`addToList:${l.id}`}>
                            {l.name}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Remove from">
                        {lists.filter((l) => l.type === 'static').map((l) => (
                          <option key={`rm-${l.id}`} value={`removeFromList:${l.id}`}>
                            {l.name}
                          </option>
                        ))}
                      </optgroup>
                    </Select>
                  )}
                </>
              )}

              {can.export && !selectAllMatching && (
                <Button variant="outline" size="sm" disabled={pending} onClick={() => setExporting(true)}>Export selected</Button>
              )}
              {can.delete && (
                <Button variant="danger" size="sm" disabled={pending} onClick={() => runBulk('delete')}>Delete</Button>
              )}

              <Button variant="ghost" size="sm" onClick={() => { setSelected(new Set()); setSelectAllMatching(false); }} aria-label="Clear selection">
                <X size={13} />
              </Button>
            </div>

            {tagPrompt && (
              <form
                onSubmit={(e) => { e.preventDefault(); if (tagValue.trim()) runBulk(tagPrompt, tagValue.trim()); }}
                className="flex w-full items-center gap-2 border-t border-brand-border pt-2"
              >
                <span className="text-[13px] text-fg-muted">{tagPrompt === 'tag' ? 'Add tag' : tagPrompt === 'untag' ? 'Remove tag' : 'Set source to'}</span>
                <Input value={tagValue} onChange={(e) => setTagValue(e.target.value)} className="h-8 w-56" list="bulk-tag-options" autoFocus />
                <datalist id="bulk-tag-options">
                  {(tagPrompt === 'setSource' ? facets.sources : facets.tags).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <Button type="submit" size="sm" disabled={pending || !tagValue.trim()}>Apply</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setTagPrompt(null)}>Cancel</Button>
              </form>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-card border border-border bg-surface">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[900px] text-left text-[13px]">
              <thead className="border-b border-border bg-surface-2">
                <tr className="text-[11px] uppercase tracking-wide text-fg-subtle">
                  <th className="w-10 px-3 py-2">
                    <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select all on page" className="cursor-pointer accent-[var(--color-brand)]" />
                  </th>
                  {visible.map((c) => (
                    <th key={c.key} className={cn('px-3 py-2 font-medium', c.align === 'right' && 'text-right')}>
                      {c.sort ? (
                        <button onClick={() => sortBy(c.sort!)} className="inline-flex items-center gap-1 hover:text-fg" aria-sort={sortField === c.sort ? (sortDesc ? 'descending' : 'ascending') : undefined}>
                          {c.label}
                          {sortField === c.sort && (sortDesc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={cn('border-b border-border transition-colors last:border-0 hover:bg-surface-2', selected.has(c.id) && 'bg-brand-subtle/40')}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} aria-label={`Select ${c.firstName} ${c.lastName}`} className="cursor-pointer accent-[var(--color-brand)]" />
                    </td>
                    {visible.map((col) => (
                      <td key={col.key} className={cn('px-3 py-2', col.align === 'right' && 'tabular text-right', col.key !== 'name' && col.key !== 'status' && col.key !== 'tags' && 'text-fg-muted')}>
                        <Cell column={col} contact={c} accountId={accountId} ownerName={ownerName} timeZone={timeZone} />
                      </td>
                    ))}
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={visible.length + 1} className="px-3 py-16 text-center">
                      <p className="text-sm font-medium text-fg">No contacts match these filters</p>
                      <p className="mt-1 text-[13px] text-fg-muted">Try widening your search or clearing filters.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {result.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              <p className="tabular text-[12px] text-fg-subtle">
                Page {result.page} of {result.totalPages.toLocaleString()} · {result.total.toLocaleString()} total
              </p>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" disabled={result.page === 1 || pending} onClick={() => navigate((q) => q.set('page', String(result.page - 1)))}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={result.page === result.totalPages || pending} onClick={() => navigate((q) => q.set('page', String(result.page + 1)))}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {exporting && (
        <ExportDialog accountId={accountId} filter={filter} selectedIds={[...selected]} total={result.total} facets={facets} onClose={() => setExporting(false)} />
      )}
    </>
  );
}

function Cell({ column, contact: c, accountId, ownerName, timeZone }: { column: Column; contact: Contact; accountId: string; ownerName: Map<string, string>; timeZone?: string }) {
  switch (column.key) {
    case 'name':
      return (
        <>
          <Link href={`/app/${accountId}/contacts/${c.id}`} className="font-medium text-fg hover:text-brand-text hover:underline">
            {c.firstName} {c.lastName}
          </Link>
          {c.email && <p className="text-[11px] text-fg-subtle">{c.email}</p>}
        </>
      );
    case 'status':
      return <Badge tone={STATUS_TONE[c.status]}>{CONTACT_STATUS_LABEL[c.status]}</Badge>;
    case 'phone': {
      const text = column.cell!(c);
      if (!text) return <span className="text-fg-subtle">—</span>;
      return (
        <span className="tabular">
          {c.dnc || c.status === 'do_not_call' ? <span className="text-danger">{text} · DNC</span> : text}
          {c.phone && !isUsPhone(c.phone) && <span className="ml-1 text-[10px] text-fg-subtle">non-US</span>}
        </span>
      );
    }
    case 'parcel':
      return (
        <>
          {column.cell!(c) || '—'}
          {c.property?.apn && <p className="tabular text-[11px] text-fg-subtle">{c.property.apn}</p>}
        </>
      );
    case 'tags':
      return (
        <div className="flex flex-wrap gap-1">
          {c.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      );
    case 'owner':
      return <>{c.ownerId ? (ownerName.get(c.ownerId) ?? '—') : <span className="text-fg-subtle">—</span>}</>;
    case 'lastActivity':
      return <span className="text-fg-subtle">{formatDate(c.lastActivityAt, timeZone)}</span>;
    case 'created':
      return <span className="text-fg-subtle">{formatDate(c.createdAt, timeZone)}</span>;
    default: {
      const text = column.cell?.(c) ?? '';
      return text ? <>{text}</> : <span className="text-fg-subtle">—</span>;
    }
  }
}

export { Pin };
