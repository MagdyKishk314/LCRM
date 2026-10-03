import { redirect } from 'next/navigation';
import { ArrowRight, Building2, Signal } from 'lucide-react';
import type { SessionContext } from '@/shared';
import { Badge } from '@/components/ui/badge';
import { apiGet } from '@/lib/api/server';
import { enterContext } from '@/lib/actions/context';

/**
 * Account chooser.
 *
 * One email can hold several memberships — agency staff, plus a seat in a client's
 * sub-account. Those are different jobs with different data and permissions, so the user
 * picks instead of being dropped into whichever happens to sort first.
 *
 * Reached only when there is a real choice; the root route sends single-destination users
 * straight through, and this page redirects them onward if they arrive here anyway.
 */
export default async function ChoosePage() {
  const session = await apiGet<SessionContext>('/core/auth/session');
  const { destinations } = session;

  if (destinations.length === 0) redirect('/');
  if (destinations.length === 1) redirect(destinations[0]!.href);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand">
            <Signal size={22} className="text-brand-fg" />
          </div>
          <h1 className="font-display text-[26px] leading-tight text-fg">Where to?</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {session.user.email} has access to more than one place.
          </p>
        </div>

        <div className="overflow-hidden rounded-card border border-border bg-surface">
          {destinations.map((d) => (
            <form
              key={`${d.type}-${d.id}`}
              action={async () => {
                'use server';
                await enterContext(d.type, d.id);
              }}
            >
              <button
                type="submit"
                className="group flex w-full items-center gap-3 border-b border-border px-4 py-3.5 text-left transition-colors last:border-0 hover:bg-surface-2"
              >
              <span
                className={
                  d.type === 'agency'
                    ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-fg'
                    : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand-text'
                }
              >
                <Building2 size={16} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-fg">{d.name}</p>
                <p className="truncate text-[12px] text-fg-subtle">
                  {d.type === 'agency' ? 'Agency console' : 'Sub-account'}
                </p>
              </div>

              <Badge tone={d.type === 'agency' ? 'brand' : 'neutral'}>{d.roleName}</Badge>

                <ArrowRight
                  size={15}
                  className="shrink-0 text-fg-subtle transition-colors group-hover:text-fg"
                />
              </button>
            </form>
          ))}
        </div>

        <p className="mt-4 text-center text-[12px] text-fg-subtle">
          You can move between these at any time from the account switcher.
        </p>
      </div>
    </main>
  );
}
