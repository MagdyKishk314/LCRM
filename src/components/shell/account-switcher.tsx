'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';

/**
 * Sub-account switcher.
 *
 * A LandCaller ops user belongs to many sub-accounts on one login, so this is the
 * primary navigation control — switching rebuilds the sidebar because the new account
 * has its own enabled-module set.
 */
export function AccountSwitcher() {
  const { accounts, activeAccount, activeAgency, hasAgencyAccess, activeContext } = useSession();
  const showAgencyLink = hasAgencyAccess && activeContext === 'agency';
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = accounts.filter((a) =>
    a.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2',
          'text-left transition-colors hover:bg-surface-2',
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand text-[11px] font-bold text-brand-fg">
          {initials(activeAccount?.name ?? '?')}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-fg">
            {activeAccount?.name ?? 'Select account'}
          </span>
          <span className="block truncate text-[11px] text-fg-subtle">{activeAgency?.name}</span>
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-fg-subtle" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
            <Search size={13} className="shrink-0 text-fg-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sub-accounts…"
              className="w-full bg-transparent text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none"
            />
          </div>

          <div className="max-h-72 overflow-y-auto scrollbar-thin py-1" role="listbox">
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-[13px] text-fg-subtle">No matches</p>
            )}
            {filtered.map((a) => {
              const active = a.id === activeAccount?.id;
              return (
                <button
                  key={a.id}
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    setOpen(false);
                    router.push(`/app/${a.id}`);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[13px] transition-colors',
                    active ? 'bg-brand-subtle text-brand-text' : 'text-fg hover:bg-surface-2',
                  )}
                >
                  <Building2 size={14} className="shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  {active && <Check size={14} className="shrink-0" />}
                </button>
              );
            })}
          </div>

          {showAgencyLink && (
            <div className="border-t border-border p-1">
              <button
                onClick={() => {
                  setOpen(false);
                  router.push('/agency');
                }}
                className="w-full rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                Agency console →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
