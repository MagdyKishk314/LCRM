import type { Account } from '@landcaller/shared';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsForm } from '@/components/settings/settings-form';
import { apiGet } from '@/lib/api/server';

/**
 * AGY-07 — a sub-account's settings, edited from the agency console.
 *
 * The same `SettingsForm` the sub-account's own settings screen uses. It calls
 * `updateAccount`, which revalidates both trees, so a change here shows up there and
 * vice versa without a second implementation to keep in step.
 */
export default async function AgencyAccountSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await apiGet<Account>(`/core/accounts/${id}`, { accountId: id });

  return (
    <div className="mx-auto max-w-3xl px-6 pt-5">
      <Card>
        <CardHeader>
          <CardTitle>Sub-account</CardTitle>
        </CardHeader>
        <CardBody>
          {/* Reaching this page already required agency access, which implies the
              permission to edit — the form's own gate stays for the sub-account route. */}
          <SettingsForm account={account} canEdit canChangeStatus />
        </CardBody>
      </Card>
    </div>
  );
}
