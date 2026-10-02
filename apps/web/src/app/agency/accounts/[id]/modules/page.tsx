import type { Account, ModuleKey } from '@landcaller/shared';
import { ModuleToggles } from '@/components/settings/module-toggles';
import { apiGet } from '@/lib/api/server';
import { getOverview } from '@/lib/api/agency';

/**
 * AGY-08 — module toggles for one sub-account, from the agency console.
 *
 * Identical component to the sub-account's own screen, including the agency ceiling: a
 * client can never be given a module the agency's plan does not sell, whichever side of
 * the console the toggle is flipped from.
 */
export default async function AgencyAccountModulesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [account, overview] = await Promise.all([
    apiGet<Account>(`/core/accounts/${id}`, { accountId: id }),
    getOverview(),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 pt-5">
      <p className="mb-4 text-[13px] text-fg-muted">
        Choose what {account.name} can use. Core modules are always on; switching an optional
        one off hides it and closes its API, but never deletes data.
      </p>

      <ModuleToggles
        accountId={id}
        accountEnabled={account.enabledModules as ModuleKey[]}
        agencyEnabled={overview.agency.enabledModules}
        accountName={account.name}
      />
    </div>
  );
}
