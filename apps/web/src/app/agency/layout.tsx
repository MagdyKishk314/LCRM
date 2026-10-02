import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AgencyNav } from '@/components/agency/agency-nav';
import { Icon } from '@/components/shell/icon';
import { ApiError } from '@/lib/api/client';
import { getOverview } from '@/lib/api/agency';

/**
 * AGY-01 — agency console shell.
 *
 * Deliberately outside the `/app/[accountId]` shell: this whole section spans sub-accounts,
 * so there is no active account to render a switcher or module-driven sidebar from.
 *
 * Access is gated by the API. `resolveAgency` refuses anyone without an agency- or
 * platform-scoped membership, so a sub-account user reaching for this URL is turned away
 * by the server rather than by a client-side check.
 */
export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  let agencyName = 'Agency';
  let accountCount = 0;
  let firstAccountId: string | null = null;
  let denied = false;

  try {
    const overview = await getOverview();
    agencyName = overview.agency.name;
    accountCount = overview.totals.accounts;
    firstAccountId = overview.accounts[0]?.id ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.isForbidden) denied = true;
    else throw err;
  }

  if (denied) return <NoAgencyAccess />;

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand">
            <Icon name="Signal" size={15} className="text-brand-fg" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] leading-tight text-fg">
              {agencyName}
            </p>
            <p className="text-[10px] text-fg-subtle">
              {accountCount} sub-account{accountCount === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <AgencyNav />

        {firstAccountId && (
          <div className="border-t border-border p-2.5">
            <Link
              href={`/app/${firstAccountId}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <ArrowLeft size={14} />
              Back to the CRM
            </Link>
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto scrollbar-thin">{children}</main>
    </div>
  );
}

function NoAgencyAccess() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-xl text-fg">Agency access required</h1>
        <p className="mt-2 text-sm text-fg-muted">
          This console manages every sub-account, so it needs an agency-level role. Your
          access is limited to individual sub-accounts.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-text hover:underline">
          Back to the CRM
        </Link>
      </div>
    </main>
  );
}
