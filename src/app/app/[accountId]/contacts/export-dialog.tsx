'use client';

import * as React from 'react';
import { AlertCircle, Download, X } from 'lucide-react';
import {
  CONTACT_EXPORT_COLUMNS,
  CONTACT_EXPORTABLE_COLUMNS,
  CONTACT_FIELD_LABEL,
  CUSTOM_FIELD_PREFIX,
  contactFilterToParams,
  type ContactFilter,
} from '@/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import type { Facets } from '@/lib/contacts/facets';

const STORAGE = (accountId: string) => `lc:contacts:export-columns:${accountId}`;

/**
 * CNT-43 — choose what to export.
 *
 * The current filter goes as a plain link the browser downloads; a selection is too large
 * for a URL, so it is posted and the file is saved from the response. Both go through the
 * web app's export proxy, which attaches the token.
 */
export function ExportDialog({
  accountId,
  filter,
  selectedIds,
  total,
  facets,
  onClose,
}: {
  accountId: string;
  filter: ContactFilter;
  /** When present, export these rather than the filter. */
  selectedIds?: string[];
  total: number;
  facets: Facets;
  onClose: () => void;
}) {
  const [format, setFormat] = React.useState<'csv' | 'xlsx'>('csv');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [columns, setColumns] = React.useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE(accountId));
      const parsed = raw ? (JSON.parse(raw) as string[]) : null;
      return parsed?.length ? parsed : [...CONTACT_EXPORT_COLUMNS];
    } catch {
      return [...CONTACT_EXPORT_COLUMNS];
    }
  });

  const options = [
    ...CONTACT_EXPORTABLE_COLUMNS.map((c) => ({ key: c, label: CONTACT_FIELD_LABEL[c] ?? c })),
    ...facets.fields.map((f) => ({ key: `${CUSTOM_FIELD_PREFIX}${f.key}`, label: f.label })),
  ];

  const toggle = (key: string) => setColumns((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));

  async function run() {
    if (columns.length === 0) return setError('Choose at least one column.');
    setError(null);
    try {
      window.localStorage.setItem(STORAGE(accountId), JSON.stringify(columns));
    } catch {
      // Fine without.
    }

    if (!selectedIds?.length) {
      const params = new URLSearchParams({ accountId, ...contactFilterToParams(filter), format, columns: columns.join(',') });
      window.location.assign(`/api/contacts/export?${params}`);
      onClose();
      return;
    }

    setPending(true);
    try {
      const res = await fetch('/api/contacts/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, ids: selectedIds, format, columns: columns.join(',') }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Export failed');
      }
      const blob = await res.blob();
      const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? `contacts.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-fg/20 p-4 pt-16" role="dialog" aria-modal="true" aria-label="Export contacts" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-card border border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">
            Export {selectedIds?.length ? `${selectedIds.length.toLocaleString()} selected` : `${total.toLocaleString()} matching`} contact{(selectedIds?.length ?? total) === 1 ? '' : 's'}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-fg-subtle hover:text-fg">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
              <p className="text-[13px] text-danger">{error}</p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-fg-subtle">Columns</p>
            <div className="flex gap-2 text-[12px]">
              <button className="text-fg-muted hover:text-fg" onClick={() => setColumns(options.map((o) => o.key))}>All</button>
              <button className="text-fg-muted hover:text-fg" onClick={() => setColumns([...CONTACT_EXPORT_COLUMNS])}>Default</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {options.map((o) => (
              <label key={o.key} className="flex items-center gap-1.5 text-[13px] text-fg">
                <input type="checkbox" checked={columns.includes(o.key)} onChange={() => toggle(o.key)} className="accent-brand" />
                {o.label}
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <Select value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'xlsx')} className="w-auto" aria-label="Format">
              <option value="csv">CSV</option>
              <option value="xlsx">Excel (.xlsx)</option>
            </Select>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={run} disabled={pending}>
                <Download size={13} /> {pending ? 'Preparing…' : 'Export'}
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-fg-subtle">Every export is recorded in the audit log with who, what and how many.</p>
        </div>
      </div>
    </div>
  );
}
