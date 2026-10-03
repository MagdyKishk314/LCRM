import { hasPermission, type ImportJob } from '@/shared';
import { PageHeader } from '@/components/shell/page-header';
import { apiGet } from '@/lib/api/server';
import { AccessDenied, loadPage } from '@/lib/guard';
import { ImportsList } from './imports-list';

export type ImportJobRow = ImportJob & { userName: string | null };

/** CNT-39 — every import that was run, and the option to undo one. */
export default async function ImportsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  const loaded = await loadPage(accountId, { module: 'contacts', permissions: ['contacts:contact:import'] }, () =>
    apiGet<{ data: ImportJobRow[] }>('/contacts/import/jobs', { accountId }),
  );
  if (!loaded.allowed) return <AccessDenied module="contacts" reason={loaded.reason} />;

  return (
    <div className="mx-auto max-w-4xl pb-10">
      <PageHeader title="Imports" description="Every file imported into this sub-account. An import can be undone for 30 days: the contacts it created are deleted; the ones it updated are kept." />
      <div className="px-6">
        <ImportsList accountId={accountId} jobs={loaded.data.data} canUndo={hasPermission(loaded.session.permissions, 'contacts:contact:delete')} />
      </div>
    </div>
  );
}
