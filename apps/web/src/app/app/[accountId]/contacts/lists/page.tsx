import { hasPermission, type ContactList } from '@landcaller/shared';
import { PageHeader } from '@/components/shell/page-header';
import { apiGet } from '@/lib/api/server';
import { EMPTY_FACETS, type Facets } from '@/lib/contacts/facets';
import { AccessDenied, loadPage } from '@/lib/guard';
import { ListsManager } from './lists-manager';

export default async function ListsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  const loaded = await loadPage(accountId, { module: 'contacts', permissions: ['contacts:list:read'] }, () =>
    Promise.all([
      apiGet<{ data: ContactList[] }>('/contacts/lists/all', { accountId }),
      apiGet<Facets>('/contacts/facets', { accountId }),
    ]),
  );
  if (!loaded.allowed) return <AccessDenied module="contacts" reason={loaded.reason} />;

  const { session, data: [lists, facets] } = loaded;
  const canManage = hasPermission(session.permissions, 'contacts:list:manage');

  return (
    <div className="pb-10">
      <PageHeader
        title="Lists"
        description="Smart lists re-evaluate as contacts change. Static lists hold a fixed set you add to."
      />
      <div className="px-6">
        <ListsManager accountId={accountId} lists={lists.data} facets={facets ?? EMPTY_FACETS} canManage={canManage} />
      </div>
    </div>
  );
}
