import {
  contactFilterToParams,
  hasPermission,
  parseContactFilter,
  type Contact,
  type ContactList,
  type Paginated,
} from '@/shared';
import { PageHeader } from '@/components/shell/page-header';
import { apiGet, apiGetOptional } from '@/lib/api/server';
import { EMPTY_FACETS, type Facets } from '@/lib/contacts/facets';
import { AccessDenied, loadPage } from '@/lib/guard';
import { ContactsTable } from '../contacts-table';

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId } = await params;
  const sp = await searchParams;

  // The URL is the single source of truth for the current view, so a filtered list is
  // shareable and survives a reload — and the server fetches only the page being viewed.
  const filter = parseContactFilter(sp);
  const page = Number(sp.page ?? 1) || 1;
  const sort = typeof sp.sort === 'string' ? sp.sort : undefined;
  const query = new URLSearchParams({ ...contactFilterToParams(filter), page: String(page), pageSize: '25', ...(sort ? { sort } : {}) });

  const loaded = await loadPage(
    accountId,
    { module: 'contacts', permissions: ['contacts:contact:read'] },
    () =>
      Promise.all([
        apiGet<Paginated<Contact>>(`/contacts?${query}`, { accountId }),
        apiGet<Facets>('/contacts/facets', { accountId }),
        apiGetOptional<{ data: ContactList[] }>('/contacts/lists/all', { accountId }),
      ]),
  );
  if (!loaded.allowed) return <AccessDenied module="contacts" reason={loaded.reason} />;

  const { session, data: [result, facets, lists] } = loaded;
  const activeList = filter.listId ? lists?.data.find((l) => l.id === filter.listId) : undefined;

  const can = {
    create: hasPermission(session.permissions, 'contacts:contact:create'),
    update: hasPermission(session.permissions, 'contacts:contact:update'),
    delete: hasPermission(session.permissions, 'contacts:contact:delete'),
    export: hasPermission(session.permissions, 'contacts:contact:export'),
    import: hasPermission(session.permissions, 'contacts:contact:import'),
    manageLists: hasPermission(session.permissions, 'contacts:list:manage'),
  };

  return (
    <div className="pb-10">
      <PageHeader
        title={activeList ? activeList.name : 'Contacts'}
        description={
          activeList
            ? (activeList.description ?? `${activeList.type === 'smart' ? 'Smart' : 'Static'} list`)
            : 'Owners and leads for this sub-account.'
        }
      />

      <ContactsTable
        accountId={accountId}
        result={result}
        filter={filter}
        sort={sort}
        lists={lists?.data ?? []}
        facets={facets ?? EMPTY_FACETS}
        can={can}
      />
    </div>
  );
}
