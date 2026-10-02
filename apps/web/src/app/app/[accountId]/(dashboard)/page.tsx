import Link from 'next/link';
import { ArrowUpRight, PhoneCall, Target, TrendingUp, Users } from 'lucide-react';
import type { Activity } from '@landcaller/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet, getSession } from '@/lib/api/server';

interface DashboardData {
  contacts: { total: number; qualified: number; newThisMonth: number };
  pipeline: {
    name: string;
    stages: { id: string; name: string; count: number; value: number; probability: number }[];
    openValue: number;
    weightedValue: number;
    openCount: number;
  } | null;
  activities: Activity[];
}

/** CORE-05 — sub-account overview, from one aggregate call. */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  const [session, data] = await Promise.all([
    getSession(accountId),
    apiGet<DashboardData>('/core/dashboard', { accountId }),
  ]);

  const account = session.activeAccount!;
  const { contacts, pipeline, activities } = data;

  return (
    <div className="pb-10">
      <PageHeader
        title={account.name}
        description={
          account.markets?.length
            ? `Target markets: ${account.markets.join(' · ')}`
            : 'Sub-account overview'
        }
      />

      <div className="grid grid-cols-1 gap-4 px-6 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Contacts"
          value={contacts.total.toLocaleString()}
          detail={`+${contacts.newThisMonth.toLocaleString()} in 30 days`}
          icon={<Users size={15} />}
        />
        <Stat
          label="Qualified leads"
          value={contacts.qualified.toLocaleString()}
          detail="Ready for an offer"
          icon={<Target size={15} />}
        />
        <Stat
          label="Open pipeline"
          value={pipeline ? `$${pipeline.openValue.toLocaleString()}` : '—'}
          detail={pipeline ? `${pipeline.openCount} opportunities` : 'Pipelines module is off'}
          icon={<TrendingUp size={15} />}
        />
        <Stat
          label="Weighted forecast"
          value={pipeline ? `$${pipeline.weightedValue.toLocaleString()}` : '—'}
          detail="By stage probability"
          icon={<PhoneCall size={15} />}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 px-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>{pipeline ? pipeline.name : 'Pipeline'}</CardTitle>
            {pipeline && (
              <Link
                href={`/app/${accountId}/pipelines`}
                className="flex items-center gap-1 text-[13px] font-medium text-brand-text hover:underline"
              >
                Open board <ArrowUpRight size={13} />
              </Link>
            )}
          </CardHeader>
          <CardBody className="space-y-3">
            {!pipeline && (
              <p className="py-6 text-center text-[13px] text-fg-subtle">
                The Pipelines module is not enabled for this sub-account.
              </p>
            )}

            {pipeline?.stages.map((stage) => {
              const pct = pipeline.openValue > 0 ? (stage.value / pipeline.openValue) * 100 : 0;
              return (
                <div key={stage.id}>
                  <div className="mb-1 flex items-baseline justify-between text-[13px]">
                    <span className="font-medium text-fg">{stage.name}</span>
                    <span className="tabular text-fg-muted">
                      {stage.count} · ${stage.value.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-brand transition-all"
                      style={{ width: `${Math.max(pct, stage.count ? 2 : 0)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {activities.length === 0 && (
              <p className="py-6 text-center text-[13px] text-fg-subtle">No activity yet.</p>
            )}

            {activities.map((a) => (
              <div key={a.id} className="flex gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-fg">{a.title}</p>
                  <p className="text-[11px] text-fg-subtle">
                    {new Date(a.occurredAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
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
