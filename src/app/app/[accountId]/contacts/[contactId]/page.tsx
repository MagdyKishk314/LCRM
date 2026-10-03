import { notFound } from 'next/navigation';
import { hasPermission, type ContactDetail, type ContactList } from '@/shared';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet, apiGetOptional } from '@/lib/api/server';
import { ApiError } from '@/lib/api/client';
import { AccessDenied, loadPage } from '@/lib/guard';
import { ContactHeader } from './contact-header';
import { ContactDetails } from './contact-details';
import { ContactShortcuts } from './contact-shortcuts';
import { CustomFieldsCard } from './custom-fields-card';
import { HistoryPanel } from './history-panel';
import { ListsCard } from './lists-card';
import { ParcelsCard } from './parcels-card';

export interface Facets {
  states: string[];
  counties: string[];
  tags: string[];
  sources: string[];
  owners: { id: string; name: string; email: string }[];
}

/**
 * The contact record (CNT-19 → CNT-28).
 *
 * One request loads everything (CNT-14); the facets give the owner and tag pickers their
 * choices. The page is read mid-call, so it renders complete and edits happen card by
 * card without rearranging anything.
 */
export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ accountId: string; contactId: string }>;
}) {
  const { accountId, contactId } = await params;

  const loaded = await loadPage(
    accountId,
    { module: 'contacts', permissions: ['contacts:contact:read'] },
    async () => {
      const [contact, facets, lists] = await Promise.all([
        apiGet<ContactDetail>(`/contacts/${contactId}`, { accountId }).catch((err) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
        apiGet<Facets>('/contacts/facets', { accountId }),
        apiGetOptional<{ data: ContactList[] }>('/contacts/lists/all', { accountId }),
      ]);
      return { contact, facets, lists: lists?.data ?? [] };
    },
  );
  if (!loaded.allowed) return <AccessDenied module="contacts" reason={loaded.reason} />;

  const { session, data } = loaded;
  if (!data.contact) notFound();
  const contact = data.contact;

  const can = {
    edit: hasPermission(session.permissions, 'contacts:contact:update'),
    delete: hasPermission(session.permissions, 'contacts:contact:delete'),
    email: session.enabledModules.includes('email') && hasPermission(session.permissions, 'email:message:send'),
    tasks: hasPermission(session.permissions, 'contacts:task:manage'),
    appointments: hasPermission(session.permissions, 'contacts:appointment:manage'),
    lists: hasPermission(session.permissions, 'contacts:list:read'),
  };

  return (
    <div className="pb-10">
      <ContactShortcuts accountId={accountId} contactId={contactId} canEmail={can.email && Boolean(contact.email)} />

      <ContactHeader accountId={accountId} contact={contact} can={can} />

      <div className="grid grid-cols-1 gap-5 px-6 pt-5 lg:grid-cols-3">
        <div className="space-y-4">
          <ContactDetails accountId={accountId} contact={contact} facets={data.facets} canEdit={can.edit} />
          <ParcelsCard accountId={accountId} contact={contact} canEdit={can.edit} />
          {contact.fieldDefinitions.length > 0 && (
            <CustomFieldsCard accountId={accountId} contact={contact} canEdit={can.edit} />
          )}
          {can.lists && <ListsCard accountId={accountId} contact={contact} lists={data.lists} canEdit={can.edit} />}

          {contact.opportunities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Opportunities</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2.5">
                {contact.opportunities.map((o) => (
                  <div key={o.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-fg">{o.name}</p>
                      <p className="text-[11px] text-fg-subtle">{o.status}</p>
                    </div>
                    <span className="tabular shrink-0 text-[13px] font-semibold text-fg">
                      ${o.value.toLocaleString()}
                    </span>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2">
          <HistoryPanel
            accountId={accountId}
            contact={contact}
            owners={data.facets.owners}
            currentUserId={session.user.id}
            can={can}
          />
        </div>
      </div>
    </div>
  );
}
