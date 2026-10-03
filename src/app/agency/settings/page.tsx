import { getModule } from '@/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { getOverview } from '@/lib/api/agency';
import { AgencyForm } from './agency-form';

/** AGY-12 — the agency's own record. */
export default async function AgencySettingsPage() {
  const { agency, plan, totals } = await getOverview();

  return (
    <div className="mx-auto max-w-3xl pb-10">
      <PageHeader title="Agency settings" description="Your agency's own details and plan." />

      <div className="space-y-4 px-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardBody>
            <AgencyForm
              name={agency.name}
              branding={agency.branding ?? {}}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plan</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {plan ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-fg">{plan.name}</span>
                  <span className="tabular text-[13px] text-fg-muted">
                    {totals.accounts} of {plan.limits.accounts} sub-accounts ·{' '}
                    {totals.users} of {plan.limits.users} seats
                  </span>
                </div>

                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                    Modules this plan sells
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {plan.modules
                      .filter((k) => !getModule(k)?.core)
                      .map((k) => (
                        <Badge key={k} tone="brand">
                          {getModule(k)?.name ?? k}
                        </Badge>
                      ))}
                  </div>
                </div>

                <p className="border-t border-border pt-3 text-[12px] text-fg-subtle">
                  Changing plans and per-sub-account subscriptions arrive with the Billing
                  module. Today one plan covers the whole agency.
                </p>
              </>
            ) : (
              <p className="text-[13px] text-fg-subtle">No plan assigned to this agency.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
