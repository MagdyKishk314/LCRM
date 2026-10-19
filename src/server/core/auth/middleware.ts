import type { NextFunction, Request, Response } from 'express';
import {
  hasAnyPermission,
  resolveModules,
  resolvePermissions,
  type ModuleKey,
  type Permission,
} from '@/shared';
import { Account, Agency, Membership, Plan, Role, User } from '../../models';
import { cached } from '../cache';
import { forbidden, unauthorized } from '../errors';
import { runInTenantContext, type TenantContext } from '../tenancy/context';
import { looksLikeJwt, verifyContextToken, type ContextClaims } from './context-token';
import { verifyAccessToken } from './jwt';

// Lean reads: a cached value is shared between requests, and a plain object cannot be
// saved by a handler that mistakes it for its own copy.
export const loadAgency = (id: string) => cached('Agency', id, () => Agency.findById(id).lean());
export const loadRole = (id: string) => cached('Role', id, () => Role.findById(id).lean());
export const loadPlan = (id: string) => cached('Plan', id, () => Plan.findById(id).lean());
export const loadAccount = (id: string) =>
  cached('Account', id, () => Account.findById(id).lean());

/**
 * Who is calling, and which seats they hold — read on every request, so read through the
 * cache. Suspending a user or changing a membership evicts these on the instance that did
 * it; see `core/cache` for how long another instance may lag.
 */
export const loadUser = (id: string) => cached('User', id, () => User.findById(id).lean());
export const loadMemberships = (userId: string) =>
  cached('Memberships', userId, () =>
    Membership.find({ userId, status: 'active' }).sort({ createdAt: 1 }).lean(),
  );

/** The user `authenticate` loaded, so later stages need not fetch it again. */
type AuthenticatedUser = NonNullable<Awaited<ReturnType<typeof loadUser>>>;
type AccountRecord = NonNullable<Awaited<ReturnType<typeof loadAccount>>>;
type AgencyRecord = NonNullable<Awaited<ReturnType<typeof loadAgency>>>;
type MembershipRecord = Awaited<ReturnType<typeof loadMemberships>>[number];

/** Most authority first. Used wherever several memberships apply to one context. */
const SCOPE_RANK: Record<string, number> = { platform: 0, agency: 1, account: 2 };

export function strongestMembership<T extends { scope: string }>(memberships: T[]): T | undefined {
  return [...memberships].sort(
    (a, b) => (SCOPE_RANK[a.scope] ?? 99) - (SCOPE_RANK[b.scope] ?? 99),
  )[0];
}

/**
 * Choose which membership a request runs under.
 *
 * When the user picked a context at login, honour it: entering as a sub-account user
 * means sub-account permissions, even for someone who is also an agency owner. Otherwise
 * the strongest membership wins, so nobody is downgraded by holding an extra lesser seat.
 *
 * This can only ever **narrow**. An unrecognised or unheld context falls back to the
 * strongest membership the user genuinely has, so a forged header grants nothing.
 */
export function pickMembership<T extends { scope: string }>(
  memberships: T[],
  hint: string | undefined,
  /** The sub-account being requested, when there is one. */
  accountId?: string,
): T | undefined {
  if (hint?.startsWith("account:")) {
    // Only narrow for the account the user actually chose. Without this check, an agency
    // operator whose cookie says `account:A` would be downgraded to member permissions
    // while administering client B from the console — their own choice quietly limiting
    // a context it was never about.
    const chosenId = hint.slice("account:".length);
    if (!accountId || chosenId === accountId) {
      const accountScoped = memberships.find((m) => m.scope === "account");
      if (accountScoped) return accountScoped;
    }
  }
  if (hint === "agency") {
    const agencyScoped = memberships.find((m) => m.scope === "agency" || m.scope === "platform");
    if (agencyScoped) return agencyScoped;
  }
  return strongestMembership(memberships);
}

/**
 * The context the caller presents.
 *
 * `X-Context` carries either a context token (see `context-token.ts`) or, from a client
 * that has not been issued one, the bare choice made at login. The token holds the same
 * choice as one of its claims, so a hint is always recoverable.
 */
export function contextHint(req: Request): string | undefined {
  const header = req.headers['x-context'] as string | undefined;
  if (!header) return undefined;
  if (!looksLikeJwt(header)) return header;
  return verifyContextToken(header)?.hint;
}

/** The context token on the request, when it is valid and was issued to this very user. */
function presentedContext(req: Request): ContextClaims | null {
  const claims = verifyContextToken(req.headers['x-context'] as string | undefined);
  return claims && claims.sub === req.userId ? claims : null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      userId?: string;
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Stage 1 — authenticate.
 * Establishes *who*, nothing more. Tenant context comes later, once we know where.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();

    const payload = verifyAccessToken(header.slice(7));
    const user = await loadUser(payload.sub);

    if (!user) throw unauthorized('User no longer exists');
    if (user.status === 'suspended') throw forbidden('This account has been suspended');

    req.userId = String(user._id);
    // Kept on the request: the session endpoint reads the name and email from it, and
    // fetching the same row twice is one more round trip on every page.
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// ── Resolving a context from the database ───────────────────────────────────
//
// The long way: the memberships, the agency, its plan and the seat's role. Run once when a
// context token is issued, and on any request that arrives without a usable one.

/** The agency, its plan and the seat's role, with the checks that apply to all of them. */
async function resolveSeat(agencyId: string, membership: MembershipRecord) {
  const [agency, role] = await Promise.all([loadAgency(agencyId), loadRole(String(membership.roleId))]);
  if (!agency) throw forbidden('Agency not found');
  if (!role) throw forbidden('Role not found');
  if (agency.status === 'suspended') throw forbidden('This agency is suspended');

  const plan = await loadPlan(String(agency.planId));

  // The agency ceiling: what any sub-account beneath it may enable. Resolving it is
  // idempotent, so a sub-account's modules can later be resolved against it directly.
  const modules = resolveModules({
    planModules: (plan?.modules ?? []) as ModuleKey[],
    agency: {
      enabled: agency.enabledModules as ModuleKey[],
      grants: agency.moduleGrants as ModuleKey[],
      denies: agency.moduleDenies as ModuleKey[],
    },
  });

  const permissions = resolvePermissions({
    rolePermissions: role.permissions as Permission[],
    grant: membership.permissionOverrides?.grant as Permission[] | undefined,
    deny: membership.permissionOverrides?.deny as Permission[] | undefined,
  });

  return { agency, modules, permissions };
}

export interface ResolvedAccountContext {
  account: AccountRecord;
  agency: AgencyRecord;
  membership: MembershipRecord;
  /** The agency ceiling. */
  modules: ModuleKey[];
  permissions: Permission[];
}

/**
 * The seat a user holds in a sub-account, and everything that seat resolves to.
 *
 * Membership on the account itself, or on the agency above it — an agency admin works
 * across every sub-account without a row per account. One person may hold several
 * memberships that all reach this sub-account; the **strongest** wins unless the user
 * chose otherwise at login (see `pickMembership`).
 */
export async function resolveAccountContext(
  userId: string,
  accountId: string,
  hint: string | undefined,
): Promise<ResolvedAccountContext> {
  const [account, memberships] = await Promise.all([loadAccount(accountId), loadMemberships(userId)]);
  if (!account) throw forbidden('Sub-account not found');

  const candidates = memberships.filter(
    (m) =>
      (m.scope === 'account' && String(m.accountId) === accountId) ||
      (m.scope === 'agency' && String(m.agencyId) === String(account.agencyId)) ||
      m.scope === 'platform',
  );
  const membership = pickMembership(candidates, hint, accountId);
  if (!membership) throw forbidden('You do not have access to this sub-account');

  assertAccountOpen(account, membership.scope);

  const seat = await resolveSeat(String(account.agencyId), membership);
  return { account, membership, ...seat };
}

export interface ResolvedAgencyContext {
  agency: AgencyRecord;
  membership: MembershipRecord;
  modules: ModuleKey[];
  permissions: Permission[];
}

/**
 * The agency seat a user holds, for the console.
 *
 * One person may hold an agency seat in more than one agency, so `requestedAgency` picks
 * between them. It can only select a seat the user genuinely holds: naming an agency they
 * have no seat in falls through to a platform membership if there is one, and otherwise
 * to nothing. With no request, the oldest agency seat wins, which is the behaviour a
 * single-agency user has always had.
 */
export async function resolveAgencyContext(
  userId: string,
  requestedAgency: string | undefined,
): Promise<ResolvedAgencyContext> {
  // 'agency' before 'platform', oldest seat first — the list arrives oldest first, and
  // the sort is stable.
  const seats = (await loadMemberships(userId))
    .filter((m) => m.scope === 'agency' || m.scope === 'platform')
    .sort((a, b) => a.scope.localeCompare(b.scope));

  const membership = requestedAgency
    ? (seats.find((m) => m.scope === 'agency' && String(m.agencyId) === requestedAgency) ??
      seats.find((m) => m.scope === 'platform'))
    : seats[0];
  if (!membership) throw forbidden('This requires agency-level access');

  // A platform membership carries no agencyId of its own, so it must name the agency
  // it is acting on. Agency members always act on their own.
  const agencyId = membership.scope === 'platform' ? requestedAgency : String(membership.agencyId);
  if (!agencyId) throw forbidden('No agency selected for this request');

  const seat = await resolveSeat(agencyId, membership);
  return { membership, ...seat };
}

/**
 * A paused or archived sub-account is closed to its own members.
 *
 * The status used to be a label: the record said "archived" and everything kept working.
 * Agency and platform staff still get in, because somebody has to be able to open it to
 * un-archive it.
 */
function assertAccountOpen(account: AccountRecord, scope: string) {
  if (account.status !== 'active' && scope === 'account') {
    throw forbidden(`This sub-account is ${account.status}. Ask your agency to reactivate it.`);
  }
}

/** A sub-account's effective modules: its own toggles, within the agency ceiling. */
function accountModules(account: AccountRecord, ceiling: ModuleKey[]): ModuleKey[] {
  return resolveModules({
    planModules: ceiling,
    agency: { enabled: ceiling },
    account: {
      enabled: account.enabledModules as ModuleKey[],
      grants: account.moduleGrants as ModuleKey[],
      denies: account.moduleDenies as ModuleKey[],
    },
  });
}

/**
 * Stage 2 — resolve tenant context.
 *
 * Reads the target account from the `X-Account-Id` header (or `?accountId=`), proves the
 * user is a member of it, then resolves the effective module set and permissions once and
 * pins them to the request. Everything downstream — including the Mongoose tenancy plugin —
 * reads from this context, so an unresolvable account means the request never touches data.
 *
 * With a context token for this sub-account (or for the agency above it) the seat is
 * already settled, and the only read is the sub-account itself — its status and module
 * toggles are the one thing that must not wait for a reissue.
 */
export async function resolveTenant(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw unauthorized();

    const accountId =
      (req.headers['x-account-id'] as string | undefined) ??
      (req.query.accountId as string | undefined);

    if (!accountId) throw forbidden('No sub-account selected for this request');

    const claims = presentedContext(req);
    const account = await loadAccount(accountId);
    if (!account) throw forbidden('Sub-account not found');

    let ctx: TenantContext;

    if (
      claims &&
      claims.agencyId === String(account.agencyId) &&
      (claims.scope === 'agency' || claims.accountId === accountId)
    ) {
      assertAccountOpen(account, claims.scope);
      ctx = {
        userId: req.userId,
        agencyId: claims.agencyId,
        accountId,
        scope: claims.scope,
        permissions: claims.permissions,
        enabledModules: accountModules(account, claims.modules),
      };
    } else {
      // No token, or one for somewhere else: resolve from the database. A token for a
      // different sub-account is not an error — an agency owner's console token does not
      // name one — it simply does not help here.
      const resolved = await resolveAccountContext(req.userId, accountId, contextHint(req));
      ctx = {
        userId: req.userId,
        agencyId: String(account.agencyId),
        accountId,
        scope: resolved.membership.scope as TenantContext['scope'],
        permissions: resolved.permissions,
        enabledModules: accountModules(account, resolved.modules),
      };
    }

    req.tenant = ctx;

    // Every downstream handler runs inside this context, which is what the Mongoose
    // plugin reads to scope queries. Losing it means queries throw rather than leak.
    runInTenantContext(ctx, () => next());
  } catch (err) {
    next(err);
  }
}

/**
 * Stage 2, agency variant — resolve *agency* context.
 *
 * The account-scoped `resolveTenant` above pins one `accountId`, which is exactly wrong
 * for a console whose job is spanning sub-accounts. This establishes the same tenant
 * context with `accountId` deliberately left undefined.
 *
 * That is not a loophole. The Mongoose tenancy plugin reads:
 *
 *     if (accountScoped && ctx.accountId) filter.accountId = ctx.accountId;
 *
 * so with only `agencyId` set, every query still scopes to this one agency — just across
 * all of its sub-accounts rather than one. Another agency's data stays unreachable by
 * construction, not by each handler remembering to filter.
 *
 * Requires an agency- or platform-scoped membership: an `account`-scoped user has no
 * business reading across the agency, however many accounts they belong to.
 *
 * With an agency context token this reads nothing at all.
 */
export async function resolveAgency(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw unauthorized();

    const requestedAgency = req.headers['x-agency-id'] as string | undefined;
    const claims = presentedContext(req);

    let ctx: TenantContext;

    if (
      claims &&
      claims.scope === 'agency' &&
      (!requestedAgency || requestedAgency === claims.agencyId)
    ) {
      ctx = {
        userId: req.userId,
        agencyId: claims.agencyId,
        // Intentionally absent — this is what widens the plugin's scope to the agency.
        accountId: undefined,
        scope: 'agency',
        permissions: claims.permissions,
        enabledModules: claims.modules,
      };
    } else {
      const resolved = await resolveAgencyContext(req.userId, requestedAgency);
      ctx = {
        userId: req.userId,
        agencyId: String(resolved.agency._id),
        accountId: undefined,
        scope: resolved.membership.scope as TenantContext['scope'],
        permissions: resolved.permissions,
        enabledModules: resolved.modules,
      };
    }

    req.tenant = ctx;
    runInTenantContext(ctx, () => next());
  } catch (err) {
    next(err);
  }
}

/** Convenience for the common `authenticate → resolveAgency` pair. */
export const withAgency = [authenticate, resolveAgency];


/**
 * Stage 3 — module gate.
 *
 * Disabling a module in the UI genuinely closes its API surface. Without this, a
 * disabled module would still be reachable by anyone who knows the URL.
 */
export function requireModule(key: ModuleKey) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.tenant;
    if (!ctx) return next(unauthorized());

    if (!ctx.enabledModules.includes(key)) {
      return next(
        forbidden(`The ${key} module is not enabled for this sub-account`),
      );
    }
    next();
  };
}

/**
 * Stage 4 — permission gate. Passing any one of `required` is enough.
 */
export function requirePermission(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const ctx = req.tenant;
    if (!ctx) return next(unauthorized());

    if (!hasAnyPermission(ctx.permissions, required)) {
      return next(forbidden(`Missing permission: ${required.join(' or ')}`));
    }
    next();
  };
}

/** Convenience for the common `authenticate → resolveTenant` pair. */
export const withTenant = [authenticate, resolveTenant];
