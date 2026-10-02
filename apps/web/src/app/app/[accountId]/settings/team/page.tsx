import { hasPermission, type Role } from '@landcaller/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { apiGet, apiGetOptional } from '@/lib/api/server';
import { AccessDenied, loadPage } from '@/lib/guard';
import { InviteUser } from '@/components/settings/invite-user';

interface TeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: 'active' | 'invited' | 'suspended';
  lastLoginAt?: string;
  role?: string;
  scope?: 'platform' | 'agency' | 'account';
}

export default async function TeamPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  const loaded = await loadPage(accountId, { module: 'core', permissions: ['core:user:read'] }, () =>
    Promise.all([
      apiGet<{ data: TeamMember[] }>('/core/users', { accountId }),
      // Roles need `core:role:read`, which an inviter may not hold — a null here just
      // means the invite form is unavailable, not that the page failed.
      apiGetOptional<{ data: Role[] }>('/core/roles', { accountId }),
    ]),
  );
  if (!loaded.allowed) return <AccessDenied module="core" reason={loaded.reason} />;

  const { session, data: [users, rolesRes] } = loaded;

  const canInvite = hasPermission(session.permissions, 'core:user:invite');

  // Only sub-account roles are assignable here; handing out an agency role from this
  // screen would grant access to every other sub-account.
  const assignableRoles = (rolesRes?.data ?? [])
    .filter((r) => r.scope === 'account')
    .map((r) => ({ id: r.id, name: r.name, description: r.description }));

  return (
      <div className="mx-auto max-w-4xl pb-10">
        <PageHeader
          title="Team"
          description="People with access to this sub-account."
          actions={
            canInvite ? <InviteUser accountId={accountId} roles={assignableRoles} /> : undefined
          }
        />

        <div className="px-6">
          <div className="overflow-hidden rounded-card border border-border bg-surface">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <thead className="border-b border-border bg-surface-2">
                  <tr className="text-[11px] uppercase tracking-wide text-fg-subtle">
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium">Role</th>
                    <th className="px-4 py-2 font-medium">Access</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-border last:border-0 hover:bg-surface-2"
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-fg">
                          {m.firstName} {m.lastName}
                        </p>
                        <p className="text-[11px] text-fg-subtle">{m.email}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone="brand">{m.role ?? '—'}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-fg-muted">
                        {m.scope === 'agency'
                          ? 'All sub-accounts'
                          : m.scope === 'platform'
                            ? 'Platform'
                            : 'This sub-account'}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          tone={
                            m.status === 'active'
                              ? 'success'
                              : m.status === 'invited'
                                ? 'warning'
                                : 'danger'
                          }
                        >
                          {m.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-fg-subtle">
                        {m.lastLoginAt
                          ? new Date(m.lastLoginAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })
                          : '—'}
                      </td>
                    </tr>
                  ))}

                  {users.data.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center">
                        <p className="text-sm font-medium text-fg">No team members yet</p>
                        <p className="mt-1 text-[13px] text-fg-muted">
                          Invite someone to give them access to this sub-account.
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
