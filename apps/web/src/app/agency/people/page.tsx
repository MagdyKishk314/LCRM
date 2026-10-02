import type { Role } from '@landcaller/shared';
import { PageHeader } from '@/components/shell/page-header';
import { apiGet } from '@/lib/api/server';
import { getOverview, getPeople } from '@/lib/api/agency';
import { PeopleManager } from './people-manager';

/** AGY-10 — everyone with access anywhere in the agency. */
export default async function AgencyPeoplePage() {
  const [people, overview] = await Promise.all([getPeople(), getOverview()]);

  // Roles are per-agency but fetched through a sub-account, which is the only route that
  // returns them. Any account beneath this agency yields the same list.
  const anyAccountId = overview.accounts[0]?.id;
  const rolesRes = anyAccountId
    ? await apiGet<{ data: Role[] }>('/core/roles', { accountId: anyAccountId })
    : { data: [] as Role[] };

  const roles = rolesRes.data
    .filter((r) => r.scope === 'agency' || r.scope === 'account')
    .map((r) => ({ id: r.id, name: r.name, description: r.description, scope: r.scope }));

  return (
    <div className="pb-10">
      <PageHeader
        title="People"
        description="Everyone who can reach this agency or any of its sub-accounts."
      />

      <div className="px-6">
        <PeopleManager
          people={people.data}
          roles={roles}
          accounts={overview.accounts.map((a) => ({ id: a.id, name: a.name }))}
        />
      </div>
    </div>
  );
}
