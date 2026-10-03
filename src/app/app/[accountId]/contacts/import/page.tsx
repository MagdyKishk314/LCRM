import type { ContactList } from '@/shared';
import { PageHeader } from '@/components/shell/page-header';
import { apiGet, apiGetOptional } from '@/lib/api/server';
import { EMPTY_FACETS, type Facets } from '@/lib/contacts/facets';
import { AccessDenied, loadPage } from '@/lib/guard';
import { ImportWizard } from './import-wizard';

/** CNT-12 / CNT-37 → CNT-41 — CSV and Excel import. */
export default async function ImportPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  const loaded = await loadPage(accountId, { module: 'contacts', permissions: ['contacts:contact:import'] }, () =>
    Promise.all([
      apiGet<Facets>('/contacts/facets', { accountId }),
      apiGetOptional<{ data: ContactList[] }>('/contacts/lists/all', { accountId }),
    ]),
  );
  if (!loaded.allowed) return <AccessDenied module="contacts" reason={loaded.reason} />;

  const [facets, lists] = loaded.data;

  return (
    <div className="mx-auto max-w-3xl pb-10">
      <PageHeader
        title="Import contacts"
        description="Upload a CSV or Excel file, check the column mapping, choose what a duplicate means, then import."
      />
      <div className="px-6">
        <ImportWizard accountId={accountId} facets={facets ?? EMPTY_FACETS} lists={(lists?.data ?? []).filter((l) => l.type === 'static')} />
      </div>
    </div>
  );
}
