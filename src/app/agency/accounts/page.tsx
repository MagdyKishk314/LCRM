import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { getModule } from '@/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getOverview } from '@/lib/api/agency';
import { NewAccount } from './new-account';

/** AGY-03 — the sub-account roster. */
export default async function AgencyAccountsPage() {
  const { accounts, agency, plan, totals } = await getOverview();
  const atLimit = plan ? totals.accounts >= plan.limits.accounts : false;

  return (
    <div className="pb-10">
      <PageHeader
        title="Sub-accounts"
        description="Each client gets an isolated sub-account with its own data, users and modules."
        actions={
          atLimit ? undefined : (
            <NewAccount
              currentAccountId={accounts[0]?.id ?? ''}
              agencyModules={agency.enabledModules}
            />
          )
        }
      />

      <div className="space-y-3 px-6">
        {atLimit && (
          <p className="rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2 text-[13px] text-fg">
            Your {plan?.name} plan allows {plan?.limits.accounts} sub-accounts and all are in
            use. Upgrade to add another.
          </p>
        )}

        {accounts.map((account) => (
          <div
            key={account.id}
            className="rounded-card border border-border bg-surface p-4 transition-shadow hover:shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand-text">
                  <Building2 size={16} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/agency/accounts/${account.id}`}
                      className="text-sm font-semibold text-fg hover:text-brand-text hover:underline"
                    >
                      {account.name}
                    </Link>
                    <Badge tone={account.status === 'active' ? 'success' : 'warning'}>
                      {account.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[12px] text-fg-subtle">
                    {account.markets.length ? account.markets.join(' · ') : 'No markets set'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {account.enabledModules
                      .filter((k) => !getModule(k)?.core)
                      .map((k) => (
                        <Badge key={k} tone="brand">
                          {getModule(k)?.name ?? k}
                        </Badge>
                      ))}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-5">
                <Metric label="Seats" value={String(account.users)} />
                <Link href={`/agency/accounts/${account.id}`}>
                  <Button variant="outline" size="sm">
                    Manage
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        ))}

        {accounts.length === 0 && (
          <div className="rounded-card border border-border bg-surface px-4 py-14 text-center">
            <p className="text-sm font-medium text-fg">No sub-accounts yet</p>
            <p className="mt-1 text-[13px] text-fg-muted">
              Create one to start onboarding a client.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="tabular text-sm font-semibold text-fg">{value}</p>
      <p className="text-[11px] text-fg-subtle">{label}</p>
    </div>
  );
}
