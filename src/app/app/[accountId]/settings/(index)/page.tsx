import { hasPermission, type Account } from '@/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet } from '@/lib/api/server';
import { AccessDenied, loadPage } from '@/lib/guard';
import { SettingsForm } from '@/components/settings/settings-form';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const loaded = await loadPage(accountId, { module: 'core', permissions: ['core:settings:read'] }, () =>
    apiGet<Account>(`/core/accounts/${accountId}`, { accountId }),
  );
  if (!loaded.allowed) return <AccessDenied module="core" reason={loaded.reason} />;

  const { session, data: account } = loaded;
  const canEdit = hasPermission(session.permissions, 'core:settings:update');

  return (
    <div className="mx-auto max-w-3xl pb-10">
      <PageHeader title="General settings" description="Basic details for this sub-account." />

      <div className="px-6">
        <Card>
          <CardHeader>
            <CardTitle>Sub-account</CardTitle>
          </CardHeader>
          <CardBody>
            <SettingsForm
              account={account}
              canEdit={canEdit}
              canChangeStatus={canEdit && session.scope !== 'account'}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
