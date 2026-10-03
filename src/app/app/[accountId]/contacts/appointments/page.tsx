import { hasPermission, type Appointment } from '@/shared';
import { PageHeader } from '@/components/shell/page-header';
import { apiGet } from '@/lib/api/server';
import { EMPTY_FACETS, type Facets } from '@/lib/contacts/facets';
import { AccessDenied, loadPage } from '@/lib/guard';
import { AppointmentsList, type AppointmentRow } from './appointments-list';

/** CNT-36 — upcoming appointments, mine and everyone's, and the recent past. */
export default async function AppointmentsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  const loaded = await loadPage(
    accountId,
    { module: 'contacts', permissions: ['contacts:appointment:read', 'contacts:appointment:manage'] },
    () =>
      Promise.all([
        apiGet<{ data: AppointmentRow[] }>('/contacts/appointments?when=upcoming', { accountId }),
        apiGet<{ data: AppointmentRow[] }>('/contacts/appointments?when=past&limit=50', { accountId }),
        apiGet<Facets>('/contacts/facets', { accountId }),
      ]),
  );
  if (!loaded.allowed) return <AccessDenied module="contacts" reason={loaded.reason} />;

  const { session, data: [upcoming, past, facets] } = loaded;

  return (
    <div className="pb-10">
      <PageHeader title="Appointments" description="Times agreed with owners. Entered by hand until a calendar is connected." />
      <div className="px-6">
        <AppointmentsList
          accountId={accountId}
          upcoming={upcoming.data as (Appointment & AppointmentRow)[]}
          past={past.data as (Appointment & AppointmentRow)[]}
          facets={facets ?? EMPTY_FACETS}
          currentUserId={session.user.id}
          canManage={hasPermission(session.permissions, 'contacts:appointment:manage')}
        />
      </div>
    </div>
  );
}
