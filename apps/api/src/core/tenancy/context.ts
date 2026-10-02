import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModuleKey, MembershipScope, Permission } from '@landcaller/shared';

export interface TenantContext {
  userId: string;
  agencyId: string;
  /** Absent when the request is agency- or platform-scoped rather than inside one account. */
  accountId?: string;
  scope: MembershipScope;
  permissions: Permission[];
  enabledModules: ModuleKey[];
  /**
   * Escape hatch for platform tooling (migrations, cross-tenant reports).
   * Greppable on purpose — every use should be reviewable in one search.
   */
  bypassTenantScope?: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runInTenantContext<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Fetch the context or throw.
 *
 * The tenancy plugin calls this on every query. Throwing rather than returning
 * `undefined` is the whole design: a query that somehow runs outside a request context
 * fails instead of quietly reading across every tenant in the database.
 */
export function requireTenantContext(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      'No tenant context. A tenant-scoped model was queried outside a request. ' +
        'Wrap the call in runInTenantContext(), or use .bypassTenantScope() if this is platform tooling.',
    );
  }
  return ctx;
}

/**
 * Narrow an agency-scoped context to one sub-account for the duration of `fn`.
 *
 * An agency request has no `accountId`, which is right for reading across sub-accounts
 * and wrong for writing into one: the tenancy plugin refuses to create an account-scoped
 * document without knowing which account it belongs to. This supplies that, scoped to a
 * single call, so the agency console can act on a client without the request pretending
 * to be inside it.
 *
 * The account is not taken on trust — callers must confirm it belongs to the current
 * agency first, or this would be a way to write into another tenant.
 */
export function runInAccountContext<T>(accountId: string, fn: () => T): T {
  const ctx = requireTenantContext();
  return storage.run({ ...ctx, accountId }, fn);
}


/** Run a function with tenant scoping disabled — platform admin tooling only. */
export function runUnscoped<T>(ctx: Omit<TenantContext, 'bypassTenantScope'>, fn: () => T): T {
  return storage.run({ ...ctx, bypassTenantScope: true }, fn);
}
