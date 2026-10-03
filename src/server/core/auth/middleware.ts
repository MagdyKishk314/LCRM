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
import { verifyAccessToken } from './jwt';

// Lean reads: a cached value is shared between requests, and a plain object cannot be
// saved by a handler that mistakes it for its own copy.
export const loadAgency = (id: string) => cached('Agency', id, () => Agency.findById(id).lean());
export const loadRole = (id: string) => cached('Role', id, () => Role.findById(id).lean());
export const loadPlan = (id: string) => cached('Plan', id, () => Plan.findById(id).lean());

/** The user `authenticate` loaded, so later stages need not fetch it again. */
type AuthenticatedUser = InstanceType<typeof User>;

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

/** The context the caller chose at login, if any. */
export function contextHint(req: Request): string | undefined {
  return req.headers["x-context"] as string | undefined;
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
    const user = await User.findById(payload.sub);

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

/**
 * Stage 2 — resolve tenant context.
 *
 * Reads the target account from the `X-Account-Id` header (or `?accountId=`), proves the
 * user is a member of it, then resolves the effective module set and permissions once and
 * pins them to the request. Everything downstream — including the Mongoose tenancy plugin —
 * reads from this context, so an unresolvable account means the request never touches data.
 */
export async function resolveTenant(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw unauthorized();

    const accountId =
      (req.headers['x-account-id'] as string | undefined) ??
      (req.query.accountId as string | undefined);

    if (!accountId) throw forbidden('No sub-account selected for this request');

    // Account, agency, plan and role are read through a short cache — see `core/cache`.
    // The membership lookup below is not: revoking access must bite on the next request.
    const account = await cached('Account', accountId, () => Account.findById(accountId).lean());
    if (!account) throw forbidden('Sub-account not found');

    // Membership on the account itself, or on the agency above it — an agency admin
    // works across every sub-account without a row per account.
    /**
     * One person may hold several memberships that all reach this sub-account — an
     * agency seat and a per-account seat, say. The **strongest** wins.
     *
     * Sorting by scope name did the opposite: 'account' sorts before 'agency', so an agency
     * owner who also held a sub-account seat was silently downgraded to it inside that
     * account. Nobody should lose authority by being given an extra, lesser seat.
     */
    const candidates = await Membership.find({
      userId: req.userId,
      status: 'active',
      $or: [
        { scope: 'account', accountId },
        { scope: 'agency', agencyId: account.agencyId },
        { scope: 'platform' },
      ],
    });

    const membership = pickMembership(candidates, contextHint(req), accountId);

    if (!membership) throw forbidden('You do not have access to this sub-account');

    /**
     * A paused or archived sub-account is closed to its own members.
     *
     * The status used to be a label: the record said "archived" and everything kept
     * working. Agency and platform staff still get in, because somebody has to be able to
     * open it to un-archive it.
     */
    if (account.status !== 'active' && membership.scope === 'account') {
      throw forbidden(`This sub-account is ${account.status}. Ask your agency to reactivate it.`);
    }

    const [agency, role] = await Promise.all([
      loadAgency(String(account.agencyId)),
      loadRole(String(membership.roleId)),
    ]);
    if (!agency) throw forbidden('Agency not found');
    if (!role) throw forbidden('Role not found');
    if (agency.status === 'suspended') throw forbidden('This agency is suspended');

    const plan = await loadPlan(String(agency.planId));

    const enabledModules = resolveModules({
      planModules: (plan?.modules ?? []) as ModuleKey[],
      agency: {
        enabled: agency.enabledModules as ModuleKey[],
        grants: agency.moduleGrants as ModuleKey[],
        denies: agency.moduleDenies as ModuleKey[],
      },
      account: {
        enabled: account.enabledModules as ModuleKey[],
        grants: account.moduleGrants as ModuleKey[],
        denies: account.moduleDenies as ModuleKey[],
      },
    });

    const permissions = resolvePermissions({
      rolePermissions: role.permissions as Permission[],
      grant: membership.permissionOverrides?.grant as Permission[] | undefined,
      deny: membership.permissionOverrides?.deny as Permission[] | undefined,
    });

    const ctx: TenantContext = {
      userId: req.userId,
      agencyId: String(account.agencyId),
      accountId: String(account._id),
      scope: membership.scope as TenantContext['scope'],
      permissions,
      enabledModules,
    };

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
 */
export async function resolveAgency(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.userId) throw unauthorized();

    const seats = await Membership.find({
      userId: req.userId,
      status: 'active',
      scope: { $in: ['agency', 'platform'] },
    }).sort({ scope: 1, createdAt: 1 }); // 'agency' before 'platform', oldest seat first

    const requestedAgency = req.headers['x-agency-id'] as string | undefined;

    /**
     * Which seat this request runs under.
     *
     * One person may hold an agency seat in more than one agency, so `X-Agency-Id` picks
     * between them. It can only select a seat the user genuinely holds: naming an agency
     * they have no seat in falls through to a platform membership if there is one, and
     * otherwise to nothing. With no header, the oldest agency seat wins, which is the
     * behaviour a single-agency user has always had.
     */
    const membership = requestedAgency
      ? (seats.find((m) => m.scope === 'agency' && String(m.agencyId) === requestedAgency) ??
        seats.find((m) => m.scope === 'platform'))
      : seats[0];

    if (!membership) {
      throw forbidden('This requires agency-level access');
    }

    // A platform membership carries no agencyId of its own, so it must name the agency
    // it is acting on. Agency members always act on their own.
    const agencyId =
      membership.scope === 'platform' ? requestedAgency : String(membership.agencyId);

    if (!agencyId) throw forbidden('No agency selected for this request');

    const [agency, role] = await Promise.all([
      loadAgency(agencyId),
      loadRole(String(membership.roleId)),
    ]);
    if (!agency) throw forbidden('Agency not found');
    if (!role) throw forbidden('Role not found');
    if (agency.status === 'suspended') throw forbidden('This agency is suspended');

    const plan = await loadPlan(String(agency.planId));

    // The agency ceiling — what any sub-account beneath it may have — resolved without
    // an account layer.
    const enabledModules = resolveModules({
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

    const ctx: TenantContext = {
      userId: req.userId,
      agencyId: String(agency._id),
      // Intentionally absent — this is what widens the plugin's scope to the agency.
      accountId: undefined,
      scope: membership.scope as TenantContext['scope'],
      permissions,
      enabledModules,
    };

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
