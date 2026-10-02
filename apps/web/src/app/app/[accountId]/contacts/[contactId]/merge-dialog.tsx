'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Search, X } from 'lucide-react';
import { formatPhone, type Contact, type ContactDetail } from '@landcaller/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { checkDuplicates, mergeContacts, searchContacts, type MergeField } from '@/lib/actions/contacts';

type Candidate = Pick<Contact, 'id' | 'firstName' | 'lastName' | 'email' | 'phone' | 'status'> & { company?: string; source?: string };

const FIELDS: { key: MergeField; label: string; show: (c: Candidate | ContactDetail) => string }[] = [
  { key: 'firstName', label: 'First name', show: (c) => c.firstName },
  { key: 'lastName', label: 'Last name', show: (c) => c.lastName },
  { key: 'phone', label: 'Phone', show: (c) => (c.phone ? formatPhone(c.phone) : '—') },
  { key: 'email', label: 'Email', show: (c) => c.email ?? '—' },
  { key: 'company', label: 'Company', show: (c) => ('company' in c && c.company) || '—' },
  { key: 'source', label: 'Source', show: (c) => ('source' in c && c.source) || '—' },
];

/**
 * CNT-27 — merge a duplicate into this record.
 *
 * Likely duplicates (same phone or email) are offered first; any other contact can be found
 * by name. For each single-valued field the person chooses which value survives; tags,
 * phones, parcels, lists and history are always combined. The duplicate is then removed.
 */
export function MergeDialog({
  accountId,
  survivor,
  onClose,
}: {
  accountId: string;
  survivor: ContactDetail;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [chosen, setChosen] = React.useState<Candidate | null>(null);
  const [take, setTake] = React.useState<Set<MergeField>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    checkDuplicates(accountId, { phone: survivor.phone, email: survivor.email, exclude: survivor.id }).then((res) => {
      if (res.ok) setCandidates(res.data);
    });
  }, [accountId, survivor.id, survivor.phone, survivor.email]);

  React.useEffect(() => {
    if (query.trim().length < 2) return;
    const timer = setTimeout(async () => {
      const res = await searchContacts(accountId, query.trim());
      if (res.ok) setCandidates(res.data.filter((c) => c.id !== survivor.id));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, accountId, survivor.id]);

  function merge() {
    if (!chosen) return;
    if (!window.confirm(`Merge ${chosen.firstName} ${chosen.lastName} into ${survivor.firstName} ${survivor.lastName}? The duplicate is deleted.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await mergeContacts(accountId, survivor.id, chosen.id, [...take]);
      if (res.ok) {
        onClose();
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-fg/20 p-4 pt-16" role="dialog" aria-modal="true" aria-label="Merge contacts" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl rounded-card border border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-fg">Merge a duplicate into {survivor.firstName} {survivor.lastName}</h2>
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

          {!chosen ? (
            <>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find the duplicate by name, phone or email…" className="pl-8" autoFocus />
              </div>
              <div className="divide-y divide-border rounded-lg border border-border">
                {candidates.length === 0 && (
                  <p className="px-3 py-6 text-center text-[13px] text-fg-subtle">
                    {query.trim().length < 2 ? 'No contact shares this phone or email. Search above to pick one.' : 'No matches.'}
                  </p>
                )}
                {candidates.map((c) => (
                  <button key={c.id} onClick={() => setChosen(c)} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-surface-2">
                    <span className="text-[13px] font-medium text-fg">
                      {c.firstName} {c.lastName}
                    </span>
                    <span className="tabular text-[12px] text-fg-subtle">
                      {c.phone ? formatPhone(c.phone) : ''} {c.email ?? ''}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-[13px] text-fg-muted">
                Choose which value to keep for each field. Tags, other phones, parcels, lists, history, tasks and
                opportunities from both are combined. Do-not-contact from either is kept.
              </p>
              <table className="w-full text-left text-[13px]">
                <thead className="text-[11px] uppercase tracking-wide text-fg-subtle">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Field</th>
                    <th className="py-1.5 pr-3 font-medium">Keep (this record)</th>
                    <th className="py-1.5 font-medium">Take (duplicate)</th>
                  </tr>
                </thead>
                <tbody>
                  {FIELDS.map((f) => {
                    const mine = f.show(survivor);
                    const theirs = f.show(chosen);
                    const same = mine === theirs;
                    return (
                      <tr key={f.key} className="border-t border-border">
                        <td className="py-2 pr-3 text-fg-muted">{f.label}</td>
                        <td className="py-2 pr-3">
                          <label className={`flex items-center gap-2 ${same ? 'text-fg-subtle' : 'text-fg'}`}>
                            <input type="radio" name={f.key} checked={!take.has(f.key)} disabled={same} onChange={() => setTake((s) => { const n = new Set(s); n.delete(f.key); return n; })} className="accent-brand" />
                            {mine}
                          </label>
                        </td>
                        <td className="py-2">
                          <label className={`flex items-center gap-2 ${same ? 'text-fg-subtle' : 'text-fg'}`}>
                            <input type="radio" name={f.key} checked={take.has(f.key)} disabled={same} onChange={() => setTake((s) => new Set(s).add(f.key))} className="accent-brand" />
                            {theirs}
                          </label>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex justify-between gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => setChosen(null)}>
                  Pick a different contact
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button variant="danger" size="sm" onClick={merge} disabled={pending}>
                    {pending ? 'Merging…' : 'Merge and delete duplicate'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
