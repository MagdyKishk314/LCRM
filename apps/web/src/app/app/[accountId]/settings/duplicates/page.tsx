import { hasPermission, type Contact } from '@landcaller/shared';
import { PageHeader } from '@/components/shell/page-header';
import { apiGet } from '@/lib/api/server';
import { AccessDenied, loadPage } from '@/lib/guard';
import { DuplicatesList } from './duplicates-list';

export interface DuplicateGroup {
  by: 'phone' | 'email';
  value: string;
  contacts: Pick<Contact, 'id' | 'firstName' | 'lastName' | 'email' | 'phone' | 'status' | 'property' | 'createdAt' | 'lastActivityAt'>[];
}

/** CNT-44 — likely duplicate pairs, with merge. */
export default async function DuplicatesPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  const loaded = await loadPage(accountId, { module: 'contacts', permissions: ['contacts:contact:update'] }, () =>
    apiGet<{ data: DuplicateGroup[] }>('/contacts/duplicates/all', { accountId }),
  );
  if (!loaded.allowed) return <AccessDenied module="contacts" reason={loaded.reason} />;

  return (
    <div className="mx-auto max-w-4xl pb-10">
      <PageHeader title="Duplicates" description="Contacts that share a phone number or an email address. Merging keeps one record and folds the other's history, tags, phones, parcels and lists into it." />
      <div className="px-6">
        <DuplicatesList accountId={accountId} groups={loaded.data.data} canMerge={hasPermission(loaded.session.permissions, 'contacts:contact:delete')} />
      </div>
    </div>
  );
}
