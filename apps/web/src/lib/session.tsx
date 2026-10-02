'use client';

import * as React from 'react';
import {
  buildNavigation,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  type ModuleKey,
  type Permission,
  type SessionContext,
} from '@landcaller/shared';

const Ctx = React.createContext<SessionContext | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: SessionContext;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={session}>{children}</Ctx.Provider>;
}

export function useSession(): SessionContext {
  const session = React.useContext(Ctx);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}

/**
 * Permission checks for conditional UI.
 *
 * These hide affordances the user cannot use. They are not a security boundary — the API
 * re-checks every permission on every request, because anything the browser decides is
 * advisory.
 */
export function useCan() {
  const { permissions } = useSession();

  return React.useMemo(
    () => ({
      can: (required: Permission) => hasPermission(permissions, required),
      canAny: (required: Permission[]) => hasAnyPermission(permissions, required),
      canAll: (required: Permission[]) => hasAllPermissions(permissions, required),
    }),
    [permissions],
  );
}

/** Is a module switched on for the active sub-account? */
export function useModuleEnabled(key: ModuleKey): boolean {
  const { enabledModules } = useSession();
  return enabledModules.includes(key);
}

/** The sidebar, derived from effective modules × permissions. */
export function useNavigation() {
  const { enabledModules, permissions } = useSession();
  return React.useMemo(
    () => buildNavigation(enabledModules, permissions),
    [enabledModules, permissions],
  );
}

/**
 * Renders children only when the module is on and the permissions are held.
 * Used at the top of every module page so a hand-typed URL into a disabled module
 * shows the same locked state as the nav would.
 */
export function ModuleGate({
  module,
  permissions: required = [],
  children,
  fallback,
}: {
  module: ModuleKey;
  permissions?: Permission[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const enabled = useModuleEnabled(module);
  const { canAny } = useCan();

  if (!enabled || (required.length > 0 && !canAny(required))) {
    return <>{fallback ?? <ModuleLocked moduleKey={module} enabled={enabled} />}</>;
  }
  return <>{children}</>;
}

function ModuleLocked({ moduleKey, enabled }: { moduleKey: ModuleKey; enabled: boolean }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2 text-fg-subtle">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-fg">
          {enabled ? 'You do not have access to this' : 'This module is turned off'}
        </h2>
        <p className="mt-1.5 text-sm text-fg-muted">
          {enabled
            ? `Your role does not include permission to view ${moduleKey}. An admin can grant it in Settings → Roles.`
            : `The ${moduleKey} module is not enabled for this sub-account. An admin can turn it on in Settings → Modules.`}
        </p>
      </div>
    </div>
  );
}
