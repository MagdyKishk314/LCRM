import type { Account, Role } from '@/shared';
import { apiGet } from '@/lib/api/server';
import { getPeople } from '@/lib/api/agency';
import { TeamManager } from './team-manager';

/**
 * AGY-09 — who can reach this sub-account, managed from the agency console.
 *
 * Rows come from the agency-wide people list rather than the per-account one, because
 * that list carries each person's membership id — needed to change a role or revoke
 * access from outside the account.
 */
export default async function AgencyAccountTeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [account, people, rolesRes] = await Promise.all([
    apiGet<Account>(`/core/accounts/${id}`, { accountId: id }),
    getPeople(),
    apiGet<{ data: Role[] }>('/core/roles', { accountId: id }),
  ]);

  /**
   * Direct members only.
   *
   * Agency staff can reach every sub-account, but they are not part of this client's
   * team. Listing them here would misrepresent the roster and invite someone to "remove"
   * an agency seat from a screen that cannot govern it — that belongs in People, where
   * the change is understood to affect every sub-account.
   */
  const members = people.data
    .map((person) => {
      const grant = person.access.find((a) => a.scope === 'account' && a.accountId === id);
      return grant ? { person, grant } : null;
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  const agencyStaff = people.data.filter((p) => p.access.some((a) => a.scope === 'agency'));

  const accountRoles = rolesRes.data
    .filter((r) => r.scope === 'account')
    .map((r) => ({ id: r.id, name: r.name, description: r.description }));

  return (
    <div className="mx-auto max-w-4xl px-6 pt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-fg-muted">
          {members.length} {members.length === 1 ? 'person' : 'people'} can reach{' '}
          {account.name}.
        </p>
      </div>

      <TeamManager accountId={id} members={members} roles={accountRoles} />

      <p className="mt-3 text-[12px] text-fg-subtle">
        {agencyStaff.length} agency {agencyStaff.length === 1 ? 'user' : 'users'} can also reach this
        sub-account. They are not part of its team, so they are managed in{' '}
        <span className="text-fg-muted">People</span> — a change there affects every sub-account.
      </p>
    </div>
  );
}
