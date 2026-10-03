import Link from 'next/link';
import { AlertTriangle, Building2, Layers, Users } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { getModule } from '@/shared';
import { getOverview } from '@/lib/api/agency';

/** AGY-02 — the rollup that only exists at agency level. */
export default async function AgencyOverviewPage() {
  const { agency, plan, totals, accounts } = await getOverview();

  // Worth surfacing rather than making someone scan the table for it.
  const paused = accounts.filter((a) => a.status !== 'active');
  const atLimit = plan ? totals.accounts >= plan.limits.accounts : false;

  return (
    <div className="pb-10">
      <PageHeader
        title={agency.name}
        description={
          plan
            ? `${plan.name} — ${totals.accounts} of ${plan.limits.accounts} sub-accounts used`
            : 'Agency overview'
        }
      />

      {/*
        Agency-level metrics only. Contacts, qualified leads and pipeline are deliberately
        not summed across sub-accounts — clients are unrelated businesses, so a combined
        total is a number nobody acts on. Those figures appear per client in the table.
      */}
      <div className="grid grid-cols-1 gap-4 px-6 sm:grid-cols-3">
        <Stat
          label="Sub-accounts"
          value={`${totals.activeAccounts} / ${totals.accounts}`}
          detail={totals.activeAccounts === totals.accounts ? 'All active' : 'Active of total'}
          icon={<Building2 size={15} />}
        />
        <Stat
          label="Seats in use"
          value={totals.users.toLocaleString()}
          detail={plan ? `Plan allows ${plan.limits.users.toLocaleString()}` : 'Across the agency'}
          icon={<Users size={15} />}
        />
        <Stat
          label="Plan"
          value={plan?.name ?? '—'}
          detail={
            plan
              ? `${totals.accounts} of ${plan.limits.accounts} sub-accounts used`
              : 'No plan assigned'
          }
          icon={<Layers size={15} />}
        />
      </div>

      {(paused.length > 0 || atLimit) && (
        <div className="mt-4 px-6">
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2.5">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
            <div className="text-[13px] text-fg">
              <p className="font-medium">Worth a look</p>
              <ul className="mt-1 space-y-0.5 text-fg-muted">
                {atLimit && <li>Your plan&rsquo;s sub-account limit is reached — upgrade to add another.</li>}
                {paused.length > 0 && (
                  <li>
                    {paused.length} sub-account{paused.length === 1 ? ' is' : 's are'} not active:{' '}
                    {paused.map((a) => a.name).join(', ')}
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 px-6">
        <h2 className="mb-2 text-[13px] font-semibold text-fg">Sub-accounts</h2>

        <div className="overflow-hidden rounded-card border border-border bg-surface">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="border-b border-border bg-surface-2">
                <tr className="text-[11px] uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-2 font-medium">Sub-account</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Modules</th>
                  <th className="px-4 py-2 text-right font-medium">Seats</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const optional = a.enabledModules.filter((k) => !getModule(k)?.core);
                  return (
                    <tr key={a.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/agency/accounts/${a.id}`}
                          className="font-medium text-fg hover:text-brand-text hover:underline"
                        >
                          {a.name}
                        </Link>
                        <p className="truncate text-[11px] text-fg-subtle">
                          {a.markets.length ? a.markets.join(' · ') : 'No markets set'}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={a.status === 'active' ? 'success' : 'warning'}>{a.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {optional.length > 0 ? (
                            optional.map((k) => (
                              <Badge key={k} tone="brand">
                                {getModule(k)?.name ?? k}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-[12px] text-fg-subtle">Core only</span>
                          )}
                        </div>
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-fg-muted">{a.users}</td>
                    </tr>
                  );
                })}

                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-14 text-center">
                      <p className="text-sm font-medium text-fg">No sub-accounts yet</p>
                      <p className="mt-1 text-[13px] text-fg-muted">
                        Create one to start onboarding a client.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-medium text-fg-muted">{label}</span>
          <span className="text-fg-subtle">{icon}</span>
        </div>
        <p className="tabular text-2xl font-semibold tracking-tight text-fg">{value}</p>
        <p className="mt-0.5 text-[11px] text-fg-subtle">{detail}</p>
      </CardBody>
    </Card>
  );
}
