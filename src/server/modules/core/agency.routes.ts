import { Router } from 'express';
import { z } from 'zod';
import { loadPlan, requirePermission, resolveAgency } from '../../core/auth/middleware';
import { badRequest, handler, notFound } from '../../core/errors';
import { assignableRole, inviteUserToScope } from '../../core/auth/invite-service';
import {
  Account,
  Activity,
  Agency,
  AuditLog,
  Membership,
  Plan,
  Role,
  User,
} from '../../models';

/**
 * Agency console API.
 *
 * Everything here runs under `resolveAgency`, so the tenant context carries an `agencyId`
 * and no `accountId` — the Mongoose plugin then scopes each query across this agency's
 * sub-accounts and no further.
 *
 * Routes that act on a *single* sub-account are deliberately absent. An agency user is
 * already a member of every account beneath them, so the console reuses the existing
 * per-account endpoints with `X-Account-Id` set to the target. Only genuinely
 * cross-account operations live here.
 */
export const agencyRouter = Router();

agencyRouter.use(resolveAgency);

/** Confirm an account belongs to the caller's agency before acting on it. */
async function ownedAccount(agencyId: string, accountId: string) {
  const account = await Account.findOne({ _id: accountId, agencyId });
  if (!account) throw notFound('Sub-account');
  return account;
}

// ── AGY-02 · Overview ───────────────────────────────────────────────────────

/**
 * Rollup across every sub-account.
 *
 * Counts come from one aggregation per collection rather than a query per account, so
 * adding clients does not multiply round trips to Atlas.
 */
agencyRouter.get(
  '/overview',
  handler(async (req, res) => {
    const ctx = req.tenant!;

    // Asked for together: none of these depends on another, and in a row they were five
    // trips to the database before the console could draw.
    //
    // Seats only. The console administers sub-accounts; it does not report on the CRM
    // data inside them — contact and pipeline figures belong to each client, in their
    // own CRM, and mean nothing side by side across unrelated businesses.
    const [agency, accounts, memberRows, agencyUsers] = await Promise.all([
      Agency.findById(ctx.agencyId),
      Account.find({ agencyId: ctx.agencyId }).sort({ name: 1 }),
      Membership.aggregate([
        { $match: { agencyId: ctx.agencyId, scope: 'account', status: 'active' } },
        { $group: { _id: '$accountId', n: { $sum: 1 } } },
      ]),
      Membership.countDocuments({ agencyId: ctx.agencyId, scope: 'agency', status: 'active' }),
    ]);
    if (!agency) throw notFound('Agency');

    const plan = await loadPlan(String(agency.planId));

    const members = new Map(memberRows.map((r) => [String(r._id), r]));

    const rows = accounts.map((a) => {
      const id = String(a._id);
      return {
        id,
        name: a.name,
        slug: a.slug,
        status: a.status,
        markets: a.markets ?? [],
        enabledModules: a.enabledModules,
        users: members.get(id)?.n ?? 0,
        createdAt: a.createdAt,
      };
    });

    res.json({
      agency: {
        id: String(agency._id),
        name: agency.name,
        status: agency.status,
        branding: agency.branding,
        enabledModules: agency.enabledModules,
      },
      plan: plan
        ? { id: String(plan._id), name: plan.name, limits: plan.limits, modules: plan.modules }
        : null,
      // Deliberately no cross-account sums. Adding up contacts or pipeline across
      // unrelated clients produces a number nobody acts on — those figures matter
      // per client, which is what the rows below carry.
      totals: {
        accounts: accounts.length,
        activeAccounts: accounts.filter((a) => a.status === 'active').length,
        // Agency-wide seats plus every per-account seat.
        users: agencyUsers + rows.reduce((s, r) => s + r.users, 0),
      },
      accounts: rows,
    });
  }),
);

// ── AGY-12 · Agency record ──────────────────────────────────────────────────

agencyRouter.get(
  '/',
  handler(async (req, res) => {
    const agency = await Agency.findById(req.tenant!.agencyId);
    if (!agency) throw notFound('Agency');

    const plan = await Plan.findById(agency.planId);
    res.json({ ...agency.toJSON(), plan });
  }),
);

const updateAgencySchema = z.object({
  name: z.string().min(2).max(120).optional(),
  branding: z
    .object({
      logoUrl: z.string().max(500).optional(),
      primaryColor: z.string().max(32).optional(),
      customDomain: z.string().max(180).optional(),
    })
    .optional(),
});

agencyRouter.patch(
  '/',
  requirePermission('core:settings:update'),
  handler(async (req, res) => {
    const input = updateAgencySchema.parse(req.body);
    const ctx = req.tenant!;

    const agency = await Agency.findById(ctx.agencyId);
    if (!agency) throw notFound('Agency');

    const before = agency.toJSON();
    if (input.name !== undefined) agency.name = input.name;
    if (input.branding) {
      // `branding` is an optional subdocument, so it may not exist yet on an agency
      // created before the field was added.
      agency.branding ??= {};
      for (const [k, v] of Object.entries(input.branding)) {
        if (v !== undefined) (agency.branding as Record<string, unknown>)[k] = v;
      }
    }
    await agency.save();

    await AuditLog.create({
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      action: 'agency.update',
      entity: 'Agency',
      entityId: ctx.agencyId,
      before,
      after: agency.toJSON(),
      ip: req.ip,
    });

    res.json(agency);
  }),
);

// ── AGY-10 · People across the agency ───────────────────────────────────────

/**
 * Every person with access anywhere in this agency, and how far that access reaches.
 *
 * One user may hold several memberships, so they are folded into a single row with an
 * `access` list. The console exists to answer "who can see what?", and a row per
 * membership answers it badly.
 */
agencyRouter.get(
  '/users',
  requirePermission('core:user:read'),
  handler(async (req, res) => {
    const ctx = req.tenant!;

    const memberships = await Membership.find({ agencyId: ctx.agencyId });
    const [users, roles, accounts] = await Promise.all([
      User.find({ _id: { $in: memberships.map((m) => m.userId) } }).sort({ firstName: 1 }),
      Role.find({ _id: { $in: memberships.map((m) => m.roleId) } }),
      Account.find({ agencyId: ctx.agencyId }),
    ]);

    const roleById = new Map(roles.map((r) => [String(r._id), r]));
    const accountById = new Map(accounts.map((a) => [String(a._id), a]));

    const byUser = new Map<string, typeof memberships>();
    for (const m of memberships) {
      const list = byUser.get(String(m.userId)) ?? [];
      list.push(m);
      byUser.set(String(m.userId), list);
    }

    res.json({
      data: users.map((u) => ({
        id: String(u._id),
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        status: u.status,
        lastLoginAt: u.lastLoginAt,
        access: (byUser.get(String(u._id)) ?? []).map((m) => ({
          membershipId: String(m._id),
          scope: m.scope,
          accountId: m.accountId ? String(m.accountId) : null,
          accountName: m.accountId ? (accountById.get(String(m.accountId))?.name ?? null) : null,
          roleId: String(m.roleId),
          roleName: roleById.get(String(m.roleId))?.name ?? null,
          status: m.status,
        })),
      })),
    });
  }),
);

const agencyInviteSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  roleId: z.string().min(1),
  /** Omit for an agency-wide seat; supply to grant access to one sub-account. */
  accountId: z.string().optional(),
});

/**
 * Invite someone to a sub-account, or to the agency itself.
 *
 * The sub-account invite refuses agency-scoped roles on purpose — granting one from
 * inside a single client's screen would silently hand over every other client. That guard
 * stays. This endpoint may grant agency scope, because reaching it already requires
 * agency scope, and either outcome is audited.
 */
agencyRouter.post(
  '/users/invite',
  requirePermission('core:user:invite'),
  handler(async (req, res) => {
    const input = agencyInviteSchema.parse(req.body);
    const ctx = req.tenant!;

    // The scope and the presence of an account must agree, or the membership would claim
    // a reach it does not have. Checked here because it is about this surface's inputs,
    // not about how an invite works.
    const role = await Role.findById(input.roleId);
    if (!role) throw badRequest('That role does not exist');
    if (role.scope === 'agency' && input.accountId) {
      throw badRequest('An agency role already covers every sub-account — do not pick one');
    }
    if (role.scope === 'account' && !input.accountId) {
      throw badRequest('Choose a sub-account for this role');
    }

    if (input.accountId) await ownedAccount(ctx.agencyId, input.accountId);

    const outcome = await inviteUserToScope({
      input,
      agencyId: ctx.agencyId,
      accountId: input.accountId,
      actorId: ctx.userId,
      ip: req.ip,
      // Agency scope is grantable here — reaching this endpoint already requires it, and
      // either outcome is audited under its own name. Platform scope never is.
      allowedScopes: ['account', 'agency'],
      auditActions: {
        invite: role.scope === 'agency' ? 'agency.user.grant_agency_access' : 'agency.user.invite',
        resend: 'agency.user.invite_resend',
      },
    });

    res.status(outcome.resent ? 200 : 201).json(outcome);
  }),
);

agencyRouter.patch(
  '/memberships/:id',
  requirePermission('core:user:update'),
  handler(async (req, res) => {
    const { roleId, status } = z
      .object({
        roleId: z.string().optional(),
        status: z.enum(['active', 'suspended']).optional(),
      })
      .parse(req.body);

    const ctx = req.tenant!;
    const membership = await Membership.findOne({ _id: req.params.id, agencyId: ctx.agencyId });
    if (!membership) throw notFound('Membership');

    if (roleId) {
      // Same ownership rule as inviting: another agency's custom role is not ours to assign.
      const role = await assignableRole(roleId, ctx.agencyId, ['account', 'agency']);
      if (role.scope !== membership.scope) {
        throw badRequest(
          `That role is ${role.scope}-scoped but this access is ${membership.scope}-scoped`,
        );
      }
      membership.roleId = roleId;
    }

    // Suspending your own agency seat locks you out of the console that could undo it —
    // the same dead end revoking it is refused for, below.
    if (
      status === 'suspended' &&
      String(membership.userId) === ctx.userId &&
      membership.scope === 'agency'
    ) {
      throw badRequest('You cannot suspend your own agency access');
    }
    if (status) membership.status = status;

    await membership.save();

    await AuditLog.create({
      agencyId: ctx.agencyId,
      accountId: membership.accountId ?? undefined,
      userId: ctx.userId,
      action: 'agency.membership.update',
      entity: 'Membership',
      entityId: String(membership._id),
      after: { roleId: membership.roleId, status: membership.status },
      ip: req.ip,
    });

    res.json(membership);
  }),
);

agencyRouter.delete(
  '/memberships/:id',
  requirePermission('core:user:delete'),
  handler(async (req, res) => {
    const ctx = req.tenant!;
    const membership = await Membership.findOne({ _id: req.params.id, agencyId: ctx.agencyId });
    if (!membership) throw notFound('Membership');

    // Revoking your own agency access locks you out of the console that granted it.
    if (String(membership.userId) === ctx.userId && membership.scope === 'agency') {
      throw badRequest('You cannot revoke your own agency access');
    }

    await Membership.deleteOne({ _id: membership._id });

    await AuditLog.create({
      agencyId: ctx.agencyId,
      accountId: membership.accountId ?? undefined,
      userId: ctx.userId,
      action: 'agency.membership.revoke',
      entity: 'Membership',
      entityId: String(membership._id),
      before: {
        userId: membership.userId,
        scope: membership.scope,
        accountId: membership.accountId,
      },
      ip: req.ip,
    });

    // The user identity is kept — they may hold access elsewhere, and deleting people
    // because one grant ended loses history.
    res.status(204).end();
  }),
);

// ── AGY-11 · Audit across sub-accounts ──────────────────────────────────────

agencyRouter.get(
  '/audit',
  requirePermission('core:audit:read'),
  handler(async (req, res) => {
    const { accountId, limit } = z
      .object({
        accountId: z.string().optional(),
        limit: z.coerce.number().min(1).max(200).default(100),
      })
      .parse(req.query);

    const ctx = req.tenant!;
    const logs = await AuditLog.find({
      agencyId: ctx.agencyId,
      ...(accountId ? { accountId } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(limit);

    const [users, accounts] = await Promise.all([
      // Some entries have no actor — a refused sign-in is recorded with nobody signed in.
      User.find({ _id: { $in: logs.map((l) => l.userId).filter(Boolean) } }).select(
        'firstName lastName email',
      ),
      Account.find({ agencyId: ctx.agencyId }).select('name'),
    ]);
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const accountById = new Map(accounts.map((a) => [String(a._id), a]));

    res.json({
      data: logs.map((l) => {
        const actor = userById.get(String(l.userId));
        return {
          id: String(l._id),
          action: l.action,
          entity: l.entity,
          entityId: l.entityId,
          createdAt: l.createdAt,
          accountName: l.accountId ? (accountById.get(String(l.accountId))?.name ?? null) : null,
          user: actor ? { name: `${actor.firstName} ${actor.lastName}`, email: actor.email } : null,
        };
      }),
    });
  }),
);

/** Recent activity for one sub-account, for its agency-level overview tab. */
agencyRouter.get(
  '/accounts/:id/activity',
  handler(async (req, res) => {
    const ctx = req.tenant!;
    await ownedAccount(ctx.agencyId, req.params.id!);

    const activities = await Activity.find({ accountId: req.params.id })
      .sort({ occurredAt: -1 })
      .limit(10);

    res.json({ data: activities });
  }),
);
