import Link from 'next/link';
import { getModule, type Activity, type ModuleKey } from '@/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet } from '@/lib/api/server';
import { getOverview } from '@/lib/api/agency';

/** AGY-06 — one client's numbers, without switching into their CRM. */
export default async function AgencyAccountOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [overview, activityRes] = await Promise.all([
    getOverview(),
    apiGet<{ data: Activity[] }>(`/core/agency/accounts/${id}/activity`),
  ]);

  const row = overview.accounts.find((a) => a.id === id);
  if (!row) return null;

  const optionalModules = (row.enabledModules as ModuleKey[]).filter((k) => !getModule(k)?.core);

  return (
    <div className="grid grid-cols-1 gap-4 px-6 pt-5 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {/*
          Administrative facts only. What is inside this client's CRM — contacts,
          pipeline — is theirs to read in their own account, not a number to compare
          against other clients from here.
        */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Metric label="Seats" value={String(row.users)} />
          <Metric label="Status" value={row.status} />
          <Metric label="Subscription" value={overview.plan?.name ?? '—'} />
        </div>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Modules</CardTitle>
            <Link
              href={`/agency/accounts/${id}/modules`}
              className="text-[13px] font-medium text-brand-text hover:underline"
            >
              Change
            </Link>
          </CardHeader>
          <CardBody>
            {optionalModules.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {optionalModules.map((k) => (
                  <Badge key={k} tone="brand">
                    {getModule(k)?.name ?? k}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-fg-subtle">
                Core modules only — no optional modules enabled.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {activityRes.data.length === 0 && (
            <p className="py-6 text-center text-[13px] text-fg-subtle">Nothing logged yet.</p>
          )}
          {activityRes.data.map((a) => (
            <div key={a.id} className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-fg">{a.title}</p>
                <p className="text-[11px] text-fg-subtle">
                  {new Date(a.occurredAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                </p>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border bg-surface px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="tabular mt-0.5 text-lg font-semibold text-fg">{value}</p>
    </div>
  );
}
