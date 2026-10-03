import { hasPermission, type Task } from '@/shared';
import { PageHeader } from '@/components/shell/page-header';
import { apiGet } from '@/lib/api/server';
import { EMPTY_FACETS, type Facets } from '@/lib/contacts/facets';
import { AccessDenied, loadPage } from '@/lib/guard';
import { TasksList, type TaskRow } from './tasks-list';

/** CNT-35 — My tasks: due today, overdue, upcoming; everyone's; done. */
export default async function TasksPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  const loaded = await loadPage(accountId, { module: 'contacts', permissions: ['contacts:task:read', 'contacts:task:manage'] }, () =>
    Promise.all([
      apiGet<{ data: TaskRow[] }>('/contacts/tasks?assignee=me&status=open', { accountId }),
      apiGet<{ data: TaskRow[] }>('/contacts/tasks?status=open', { accountId }),
      apiGet<{ data: TaskRow[] }>('/contacts/tasks?status=done&limit=50', { accountId }),
      apiGet<Facets>('/contacts/facets', { accountId }),
    ]),
  );
  if (!loaded.allowed) return <AccessDenied module="contacts" reason={loaded.reason} />;

  const { session, data: [mine, all, done, facets] } = loaded;

  return (
    <div className="pb-10">
      <PageHeader title="Tasks" description="Follow-ups to do, by when, for whom." />
      <div className="px-6">
        <TasksList
          accountId={accountId}
          mine={mine.data as (Task & TaskRow)[]}
          all={all.data as (Task & TaskRow)[]}
          done={done.data as (Task & TaskRow)[]}
          facets={facets ?? EMPTY_FACETS}
          currentUserId={session.user.id}
          canManage={hasPermission(session.permissions, 'contacts:task:manage')}
        />
      </div>
    </div>
  );
}
