import type { Account, ModuleKey } from '@landcaller/shared';
import { PageHeader } from '@/components/shell/page-header';
import { apiGet } from '@/lib/api/server';
import { AccessDenied, loadPage } from '@/lib/guard';
import { ModuleToggles } from '@/components/settings/module-toggles';

export default async function ModulesSettingsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const loaded = await loadPage(accountId, { module: 'core', permissions: ['core:module:toggle'] }, () =>
    apiGet<Account>(`/core/accounts/${accountId}`, { accountId }),
  );
  if (!loaded.allowed) return <AccessDenied module="core" reason={loaded.reason} />;

  const { session, data: account } = loaded;

  return (
    <div className="mx-auto max-w-3xl pb-10">
      <PageHeader
        title="Modules"
        // `account.name` often ends in a period ("Ridgeline Land Co."), so the sentence
        // is broken here rather than appended to.
        description={`Choose what ${account.name} can use. Core modules are always on; switching an optional one off hides it and closes its API, but never deletes data.`}
      />
      <div className="px-6">
        <ModuleToggles
          accountId={accountId}
          accountEnabled={account.enabledModules as ModuleKey[]}
          agencyEnabled={(session.activeAgency?.enabledModules ?? []) as ModuleKey[]}
          accountName={account.name}
        />
      </div>
    </div>
  );
}
