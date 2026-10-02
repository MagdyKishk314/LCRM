import Link from 'next/link';
import {
  hasPermission,
  type Contact,
  type EmailIdentity,
  type EmailMessage,
  type EmailTemplate,
  type Paginated,
} from '@landcaller/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { apiGet, apiGetOptional } from '@/lib/api/server';
import { AccessDenied, loadPage } from '@/lib/guard';
import { Compose } from './compose';
import { IdentitiesManager } from './identities-manager';

const STATUS_TONE: Record<EmailMessage['status'], 'neutral' | 'success' | 'warning' | 'danger' | 'info'> =
  {
    draft: 'neutral',
    queued: 'info',
    sent: 'info',
    delivered: 'success',
    bounced: 'danger',
    failed: 'danger',
  };

/**
 * Sent mail for this sub-account, and the form that sends more.
 *
 * `?contactId=` opens the composer addressed to that contact — the link a contact's page
 * uses — which is also what gives merge fields something to resolve against.
 */
export default async function EmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ contactId?: string }>;
}) {
  const { accountId } = await params;
  const { contactId } = await searchParams;

  const loaded = await loadPage(accountId, { module: 'email', permissions: ['email:message:read'] }, () =>
    Promise.all([
      apiGet<Paginated<EmailMessage>>('/email/messages?pageSize=50', { accountId }),
      apiGet<{ data: EmailIdentity[] }>('/email/identities', { accountId }),
      // Optional rather than gated on a permission check: a 403 here means no template
      // picker, and asking the API is cheaper than waiting for the session first.
      apiGetOptional<{ data: EmailTemplate[] }>('/email/templates', { accountId }),
      // A stale or foreign id in the URL should open a blank composer, not an error page.
      contactId
        ? apiGetOptional<Contact>(`/contacts/${encodeURIComponent(contactId)}`, { accountId })
        : null,
    ]),
  );
  if (!loaded.allowed) return <AccessDenied module="email" reason={loaded.reason} />;

  const { session, data: [messages, identities, templatesRes, contact] } = loaded;
  const templates = templatesRes ?? { data: [] };

  const can = (permission: string) => hasPermission(session.permissions, permission);
  const canSend = can('email:message:send');

  const verified = identities.data.filter((i) => i.verified);

  return (
    <div className="pb-10">
      <PageHeader
        title="Email"
        description="Mail sent to owners from this sub-account."
        actions={
          canSend && (
            <Compose
              accountId={accountId}
              identities={verified}
              templates={templates.data}
              contact={
                contact
                  ? {
                      id: contact.id,
                      name: `${contact.firstName} ${contact.lastName}`,
                      email: contact.email,
                      doNotContact: contact.dnc || contact.status === 'do_not_call',
                    }
                  : null
              }
            />
          )
        }
      />

      <div className="space-y-6 px-6">
        <div className="overflow-hidden rounded-card border border-border bg-surface">
          {messages.data.length === 0 && (
            <p className="px-4 py-10 text-center text-[13px] text-fg-muted">
              Nothing has been sent from this sub-account yet.
            </p>
          )}

          {messages.data.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-4 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-surface-2"
            >
              <div className="w-52 shrink-0">
                {m.contactId ? (
                  <Link
                    href={`/app/${accountId}/contacts/${m.contactId}`}
                    className="block truncate text-[13px] font-medium text-fg hover:text-brand-text hover:underline"
                  >
                    {m.to[0]}
                  </Link>
                ) : (
                  <span className="block truncate text-[13px] text-fg-muted">{m.to[0]}</span>
                )}
                <p className="truncate text-[11px] text-fg-subtle">
                  {m.to.length > 1 ? `and ${m.to.length - 1} more` : 'Sent'}
                </p>
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-fg">{m.subject}</p>
                <p className="truncate text-[12px] text-fg-subtle">
                  {m.status === 'failed' && m.error ? m.error : m.body.split('\n')[0]}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
                <span className="tabular w-16 text-right text-[11px] text-fg-subtle">
                  {new Date(m.sentAt ?? m.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </div>
          ))}
        </div>

        {messages.total > messages.data.length && (
          <p className="text-[12px] text-fg-subtle">
            Showing the {messages.data.length} most recent of {messages.total.toLocaleString()}.
          </p>
        )}

        <IdentitiesManager
          accountId={accountId}
          identities={identities.data}
          canManage={can('email:identity:manage')}
        />
      </div>
    </div>
  );
}
