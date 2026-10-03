import * as React from 'react';
import { Check, Minus } from 'lucide-react';
import {
  hasPermission,
  permissionDefsForModules,
  type ModuleKey,
  type PermissionDef,
  type Role,
} from '@/shared';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { apiGet } from '@/lib/api/server';
import { AccessDenied, loadPage } from '@/lib/guard';
import { RoleEditor } from './role-editor';

/**
 * CORE-10 — permission matrix.
 *
 * Roles come from the API; the rows come from the enabled modules' own manifests, so a
 * module that is switched off contributes no rows and the matrix never offers a
 * permission that cannot currently apply.
 */
export default async function RolesPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  const loaded = await loadPage(accountId, { module: 'core', permissions: ['core:role:read'] }, () =>
    apiGet<{ data: Role[] }>('/core/roles', { accountId }),
  );
  if (!loaded.allowed) return <AccessDenied module="core" reason={loaded.reason} />;

  const { session, data: rolesRes } = loaded;
  const roles = rolesRes.data.filter((r) => r.scope === 'account');
  const defs = permissionDefsForModules(session.enabledModules as ModuleKey[]);

  const groups = defs.reduce<Record<string, PermissionDef[]>>((acc, d) => {
    (acc[d.group] ??= []).push(d);
    return acc;
  }, {});

  // Roles belong to the agency, so they are edited with agency authority — and only with
  // permissions the editor holds, which is also all the API will accept.
  const canManage =
    hasPermission(session.permissions, 'core:role:manage') && session.scope !== 'account';
  const grantable = defs.filter((d) => hasPermission(session.permissions, d.key));

  return (
      <div className="pb-10">
        <PageHeader
          title="Roles & permissions"
          description="Roles available to this sub-account, and what each one can do."
          actions={canManage && <RoleEditor accountId={accountId} grantable={grantable} />}
        />

        <div className="px-6">
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {roles.map((r) => (
              <div key={r.id} className="rounded-card border border-border bg-surface p-3.5">
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-fg">{r.name}</h3>
                  {r.isSystem ? (
                    <Badge>System</Badge>
                  ) : (
                    canManage && (
                      <span className="ml-auto">
                        <RoleEditor accountId={accountId} role={r} grantable={grantable} />
                      </span>
                    )
                  )}
                </div>
                <p className="text-[12px] leading-relaxed text-fg-muted">{r.description}</p>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-card border border-border bg-surface">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="border-b border-border bg-surface-2">
                  <tr className="text-[11px] uppercase tracking-wide text-fg-subtle">
                    <th className="px-4 py-2 font-medium">Permission</th>
                    {roles.map((r) => (
                      <th key={r.id} className="px-3 py-2 text-center font-medium">
                        {r.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(groups).map(([group, items]) => (
                    <React.Fragment key={group}>
                      <tr className="bg-surface-2/60">
                        <td
                          colSpan={roles.length + 1}
                          className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle"
                        >
                          {group}
                        </td>
                      </tr>
                      {items.map((d) => (
                        <tr key={d.key} className="border-b border-border last:border-0">
                          <td className="px-4 py-2">
                            <p className="text-fg">{d.label}</p>
                            <code className="text-[11px] text-fg-subtle">{d.key}</code>
                          </td>
                          {roles.map((r) => (
                            <td key={r.id} className="px-3 py-2 text-center">
                              {hasPermission(r.permissions, d.key) ? (
                                <Check size={14} className="mx-auto text-success" />
                              ) : (
                                <Minus size={14} className="mx-auto text-fg-subtle/50" />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
  );
}
