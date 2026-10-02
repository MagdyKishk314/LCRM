import { hasPermission, type Contact, type Opportunity, type Pipeline } from '@landcaller/shared';
import { PageHeader } from '@/components/shell/page-header';
import { apiGet } from '@/lib/api/server';
import { AccessDenied, loadPage } from '@/lib/guard';
import { PipelineBoard } from './board';
import { PipelineToolbar } from './pipeline-toolbar';

interface BoardResponse {
  pipelines: Pipeline[];
  /** Null only when the sub-account has no pipelines at all. */
  pipeline: Pipeline | null;
  opportunities: Opportunity[];
  contacts: Pick<Contact, 'id' | 'firstName' | 'lastName' | 'phone' | 'email'>[];
}

/** PIP-01/03 — the board, for whichever pipeline is selected. */
export default async function PipelinesPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { accountId } = await params;
  const sp = await searchParams;

  // The selected pipeline lives in the URL, so a switch is shareable and survives a
  // reload. An unknown id falls back to the default rather than erroring.
  const requested = typeof sp.pipeline === 'string' ? sp.pipeline : undefined;

  // One request for the list and the selected board together, rather than one after
  // the other; the API applies the same fallback to the default pipeline.
  const query = requested ? `?pipeline=${encodeURIComponent(requested)}` : '';
  const loaded = await loadPage(
    accountId,
    { module: 'pipelines', permissions: ['pipelines:opportunity:read'] },
    () => apiGet<BoardResponse>(`/pipelines/board${query}`, { accountId }),
  );
  if (!loaded.allowed) return <AccessDenied module="pipelines" reason={loaded.reason} />;

  const { session, data: board } = loaded;
  const { pipelines, pipeline: selected } = board;

  if (!selected) {
    return <NoPipelines accountId={accountId} canManage={hasPermission(session.permissions, 'pipelines:pipeline:manage')} />;
  }

  const open = board.opportunities.filter((o) => o.status === 'open');
  const total = open.reduce((sum, o) => sum + o.value, 0);

  const can = {
    manage: hasPermission(session.permissions, 'pipelines:pipeline:manage'),
    update: hasPermission(session.permissions, 'pipelines:opportunity:update'),
    create: hasPermission(session.permissions, 'pipelines:opportunity:create'),
    delete: hasPermission(session.permissions, 'pipelines:opportunity:delete'),
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={selected.name}
        description={`${open.length} open · $${total.toLocaleString()} in this pipeline`}
      />

      <PipelineToolbar
        accountId={accountId}
        pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault }))}
        selected={selected}
        canManage={can.manage}
        canCreateOpportunity={can.create}
        contacts={board.contacts}
      />

      <PipelineBoard
        accountId={accountId}
        pipeline={selected}
        opportunities={board.opportunities}
        contacts={board.contacts}
        can={can}
      />
    </div>
  );
}

function NoPipelines({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h2 className="font-display text-xl text-fg">No pipelines yet</h2>
      <p className="mt-2 max-w-sm text-sm text-fg-muted">
        {canManage
          ? 'Create one to start tracking opportunities. You can have several — one per deal type or market.'
          : 'An admin needs to create a pipeline before opportunities can be tracked here.'}
      </p>
      {canManage && (
        <div className="mt-4">
          {/* The toolbar owns creation, so send them to it with the form open. */}
          <a
            href={`/app/${accountId}/pipelines?new=1`}
            className="text-sm font-medium text-brand-text hover:underline"
          >
            Create the first pipeline →
          </a>
        </div>
      )}
    </div>
  );
}
