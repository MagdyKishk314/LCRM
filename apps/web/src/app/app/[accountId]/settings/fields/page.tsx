import { hasPermission, type CustomFieldDef } from '@landcaller/shared';
import { PageHeader } from '@/components/shell/page-header';
import { apiGet } from '@/lib/api/server';
import { AccessDenied, loadPage } from '@/lib/guard';
import { FieldsManager } from './fields-manager';

/**
 * CORE-12 — custom fields.
 *
 * Gated on the `contacts` module rather than `core`: the field definitions belong to
 * Contacts, so a sub-account without that module has nothing to configure here.
 */
export default async function FieldsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  const loaded = await loadPage(
    accountId,
    { module: 'contacts', permissions: ['contacts:field:manage', 'contacts:contact:read'] },
    () => apiGet<{ data: CustomFieldDef[] }>('/contacts/fields', { accountId }),
  );
  if (!loaded.allowed) return <AccessDenied module="contacts" reason={loaded.reason} />;

  const { session, data: { data: fields } } = loaded;

  const canManage = hasPermission(session.permissions, 'contacts:field:manage');

  return (
      <div className="mx-auto max-w-3xl pb-10">
        <PageHeader
          title="Custom fields"
          description="Extra fields on contacts and opportunities. Deleting a field hides it — the values already stored on records are kept."
        />
        <div className="px-6">
          <FieldsManager accountId={accountId} fields={fields} canManage={canManage} />
        </div>
      </div>
  );
}
