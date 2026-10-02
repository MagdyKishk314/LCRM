import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { getAudit } from '@/lib/api/agency';

/** Human wording for the action strings the API records. */
const ACTION_LABEL: Record<string, string> = {
  'account.create': 'Created sub-account',
  'account.update': 'Updated sub-account settings',
  'account.modules.update': 'Changed modules',
  'agency.update': 'Updated agency settings',
  'agency.user.invite': 'Invited a user',
  'agency.user.grant_agency_access': 'Granted agency-wide access',
  'agency.membership.update': 'Changed access',
  'agency.membership.revoke': 'Revoked access',
  'user.invite': 'Invited a user',
  'contacts.bulk.delete': 'Bulk-deleted contacts',
};

/** Actions worth marking as consequential when scanning the log. */
const NOTABLE = new Set([
  'agency.user.grant_agency_access',
  'agency.membership.revoke',
  'contacts.bulk.delete',
]);

/** AGY-11 — what changed across the agency, and who did it. */
export default async function AgencyAuditPage() {
  const { data } = await getAudit({ limit: 100 });

  return (
    <div className="pb-10">
      <PageHeader
        title="Audit log"
        description="Every change made across the agency, newest first."
      />

      <div className="px-6">
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          {data.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-fg">
                  {ACTION_LABEL[entry.action] ?? entry.action}
                </p>
                <p className="truncate text-[11px] text-fg-subtle">
                  {entry.user ? `${entry.user.name} · ${entry.user.email}` : 'Unknown user'}
                </p>
              </div>

              {NOTABLE.has(entry.action) && <Badge tone="warning">Sensitive</Badge>}

              <Badge>{entry.accountName ?? 'Agency-wide'}</Badge>

              <time
                dateTime={entry.createdAt}
                className="tabular w-32 shrink-0 text-right text-[11px] text-fg-subtle"
              >
                {new Date(entry.createdAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: 'UTC',
                })}
              </time>
            </div>
          ))}

          {data.length === 0 && (
            <p className="px-4 py-14 text-center text-[13px] text-fg-subtle">
              Nothing recorded yet.
            </p>
          )}
        </div>

        <p className="mt-2 text-[11px] text-fg-subtle">
          Times are UTC. Showing the 100 most recent entries.
        </p>
      </div>
    </div>
  );
}
