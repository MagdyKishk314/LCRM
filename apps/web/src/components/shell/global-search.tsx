'use client';

import * as React from 'react';
import Link from 'next/link';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';

interface SearchHit {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  name?: string;
  value?: number;
  property?: { county?: string; state?: string };
}

interface SearchResults {
  contacts: SearchHit[];
  opportunities: SearchHit[];
}

/**
 * CORE-04 — global search.
 *
 * Queries `/core/search`, which only looks inside modules the sub-account has enabled,
 * so a disabled module never surfaces records here.
 */
export function GlobalSearch() {
  const { activeAccount } = useSession();
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();

    // Debounced so a fast typist does not fire a request per keystroke; the in-flight
    // request is aborted so a slow early response cannot overwrite a newer one.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&accountId=${activeAccount?.id ?? ''}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error('search failed');
        setResults((await res.json()) as SearchResults);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setResults(null);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, activeAccount?.id]);

  const base = `/app/${activeAccount?.id ?? ''}`;
  const total = (results?.contacts.length ?? 0) + (results?.opportunities.length ?? 0);

  return (
    <div ref={ref} className="relative w-full max-w-sm">
      <Search
        size={14}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
      />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results && setOpen(true)}
        placeholder="Search contacts, opportunities…"
        aria-label="Search"
        className={cn(
          'h-8 w-full rounded-lg border border-border bg-surface-2 pl-8 pr-8 text-[13px]',
          'placeholder:text-fg-subtle focus:border-brand focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/15',
        )}
      />
      {loading && (
        <Loader2
          size={13}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-fg-subtle"
        />
      )}

      {open && results && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          {total === 0 && (
            <p className="px-3 py-4 text-center text-[13px] text-fg-subtle">
              No matches for “{query.trim()}”
            </p>
          )}

          {results.contacts.length > 0 && (
            <Group label="Contacts">
              {results.contacts.map((c) => (
                <Link
                  key={c.id}
                  href={`${base}/contacts/${c.id}`}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-1.5 transition-colors hover:bg-surface-2"
                >
                  <p className="truncate text-[13px] text-fg">
                    {c.firstName} {c.lastName}
                  </p>
                  <p className="truncate text-[11px] text-fg-subtle">
                    {c.phone ?? c.email ?? ''}
                    {c.property?.county ? ` · ${c.property.county} Co, ${c.property.state}` : ''}
                  </p>
                </Link>
              ))}
            </Group>
          )}

          {results.opportunities.length > 0 && (
            <Group label="Opportunities">
              {results.opportunities.map((o) => (
                <Link
                  key={o.id}
                  href={`${base}/pipelines`}
                  onClick={() => setOpen(false)}
                  className="flex items-baseline justify-between gap-2 px-3 py-1.5 transition-colors hover:bg-surface-2"
                >
                  <span className="truncate text-[13px] text-fg">{o.name}</span>
                  <span className="tabular shrink-0 text-[11px] text-fg-subtle">
                    ${(o.value ?? 0).toLocaleString()}
                  </span>
                </Link>
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border py-1 last:border-0">
      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
        {label}
      </p>
      {children}
    </div>
  );
}
