import { hasPermission, type EmailTemplate } from '@landcaller/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { apiGet } from '@/lib/api/server';
import { AccessDenied, loadPage } from '@/lib/guard';
import { TemplateEditor } from './template-editor';

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  const loaded = await loadPage(accountId, { module: 'email', permissions: ['email:template:read'] }, () =>
    apiGet<{ data: EmailTemplate[] }>('/email/templates', { accountId }),
  );
  if (!loaded.allowed) return <AccessDenied module="email" reason={loaded.reason} />;

  const { session, data: templates } = loaded;
  const canManage = hasPermission(session.permissions, 'email:template:manage');

  return (
    <div className="pb-10">
      <PageHeader
        title="Email templates"
        description="Merge fields resolve against the contact and the sending user at send time."
        actions={canManage && <TemplateEditor accountId={accountId} />}
      />

      {templates.data.length === 0 && (
        <p className="px-6 text-[13px] text-fg-muted">
          No templates yet.{canManage ? ' Create one to reuse a message across contacts.' : ''}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 px-6 lg:grid-cols-2">
        {templates.data.map((t) => (
          <Card key={t.id}>
            <CardBody>
              <div className="mb-1 flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-fg">{t.name}</h3>
                <div className="flex shrink-0 items-center gap-2">
                  {t.category && <Badge tone="brand">{t.category}</Badge>}
                  {canManage && <TemplateEditor accountId={accountId} template={t} />}
                </div>
              </div>
              <p className="mb-3 text-[13px] text-fg-muted">{t.subject}</p>

              <pre className="mb-3 max-h-40 overflow-y-auto scrollbar-thin whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 font-sans text-[12px] leading-relaxed text-fg-muted">
                {t.body}
              </pre>

              <div className="flex flex-wrap gap-1">
                {t.mergeFields.map((f) => (
                  <code
                    key={f}
                    className="rounded bg-brand-subtle px-1.5 py-0.5 text-[11px] text-brand-text"
                  >
                    {`{{${f}}}`}
                  </code>
                ))}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
