import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import type { Account } from '@landcaller/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { apiGet } from '@/lib/api/server';
import { AccountTabs } from './account-tabs';

/**
 * AGY-05 — sub-account detail shell.
 *
 * Fetched with `accountId` set, so this uses the ordinary per-account endpoint rather
 * than a parallel agency one: an agency user is already a member of every sub-account
 * beneath them. The tenancy scoping that protects the sub-account protects this too.
 */
export default async function AgencyAccountLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let account: Account;
  try {
    account = await apiGet<Account>(`/core/accounts/${id}`, { accountId: id });
  } catch (err) {
    // A sub-account in another agency is indistinguishable from one that does not exist,
    // and should stay that way.
    if (err instanceof ApiError && (err.isForbidden || err.status === 404)) notFound();
    throw err;
  }

  return (
    <div className="pb-10">
      <div className="border-b border-border bg-surface px-6 pb-0 pt-5">
        <Link
          href="/agency/accounts"
          className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-fg-muted transition-colors hover:text-fg"
        >
          <ArrowLeft size={13} /> All sub-accounts
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-[22px] leading-tight text-fg">{account.name}</h1>
              <Badge tone={account.status === 'active' ? 'success' : 'warning'}>
                {account.status}
              </Badge>
            </div>
            <p className="mt-1 text-[13px] text-fg-muted">
              {account.markets?.length ? account.markets.join(' · ') : 'No markets set'}
            </p>
          </div>

          {/* Managing from here is the point; opening the client's own CRM is the escape hatch. */}
          <Link href={`/app/${account.id}`}>
            <Button variant="outline" size="sm">
              Open this CRM <ExternalLink size={13} />
            </Button>
          </Link>
        </div>

        <AccountTabs accountId={account.id} />
      </div>

      {children}
    </div>
  );
}
