import { Lock, ShieldAlert } from 'lucide-react';
import {
  getModule,
  hasAnyPermission,
  type ModuleKey,
  type Permission,
  type SessionContext,
} from '@landcaller/shared';
import { getSession } from './api/server';

/**
 * Server-side access checks.
 *
 * These must run *before* a page fetches its data. The client-side `ModuleGate` renders
 * only after the server component has already awaited its API calls, so a user missing a
 * permission would hit a 403 from the fetch and get an error page instead of the lock
 * screen. Checking here means the page never makes a call it is not allowed to make.
 */

export interface AccessRequest {
  module: ModuleKey;
  /** Holding any one of these is enough. Empty means membership alone suffices. */
  permissions?: Permission[];
}

export function checkAccess(
  session: SessionContext,
  req: AccessRequest,
): { allowed: true } | { allowed: false; reason: 'module' | 'permission' } {
  if (!session.enabledModules.includes(req.module)) {
    return { allowed: false, reason: 'module' };
  }
  if (req.permissions?.length && !hasAnyPermission(session.permissions, req.permissions)) {
    return { allowed: false, reason: 'permission' };
  }
  return { allowed: true };
}

export type PageLoad<T> =
  | { allowed: true; session: SessionContext; data: T }
  | { allowed: false; reason: 'module' | 'permission'; session: SessionContext };

/**
 * Fetch the session and the page's own data at the same time.
 *
 * Every page used to wait for the session, check access, and only then ask for its data:
 * two trips to the API in a row, each of them several trips to the database. Starting both
 * together costs nothing in the usual case, where access is granted. When it is refused,
 * the data request's 403 is thrown away and the lock screen is shown exactly as before;
 * any other failure still surfaces.
 */
export async function loadPage<T>(
  accountId: string,
  req: AccessRequest,
  load: () => Promise<T>,
): Promise<PageLoad<T>> {
  const pending = load().then(
    (data) => ({ ok: true as const, data }),
    (err: unknown) => ({ ok: false as const, err }),
  );

  const session = await getSession(accountId);
  const access = checkAccess(session, req);
  const result = await pending;

  if (!access.allowed) return { allowed: false, reason: access.reason, session };
  if (!result.ok) throw result.err;
  return { allowed: true, session, data: result.data };
}

export function AccessDenied({
  module,
  reason,
}: {
  module: ModuleKey;
  reason: 'module' | 'permission';
}) {
  const name = getModule(module)?.name ?? module;

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2 text-fg-subtle">
          {reason === 'module' ? <Lock size={20} /> : <ShieldAlert size={20} />}
        </div>

        <h2 className="text-base font-semibold text-fg">
          {reason === 'module' ? `${name} is turned off` : 'You do not have access to this'}
        </h2>

        <p className="mt-1.5 text-sm text-fg-muted">
          {reason === 'module'
            ? `The ${name} module is not enabled for this sub-account. An admin can turn it on in Settings → Modules.`
            : 'Your role does not include permission to view this page. An admin can grant it in Settings → Roles.'}
        </p>
      </div>
    </div>
  );
}
