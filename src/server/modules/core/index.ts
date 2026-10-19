import { Router } from 'express';
import { z } from 'zod';
import {
  coreModules,
  getModule,
  hasAnyPermission,
  hasPermission,
  listModules,
  permissionVocabulary,
  validateModuleSet,
  withDependencies,
  type ModuleKey,
} from '@/shared';
import {
  authenticate,
  loadMemberships,
  requirePermission,
  resolveTenant,
} from '../../core/auth/middleware';
import { badRequest, conflict, forbidden, handler, notFound } from '../../core/errors';
import { inviteUserToScope } from '../../core/auth/invite-service';
import { verifyByIp } from '../../core/rate-limit';
import type { ApiModule } from '../../core/registry';
import type { TenantContext } from '../../core/tenancy/context';
import { searchConditions } from '../contacts/search';
import { confirmSenderToken } from '../email/verification';
import {
  Account,
  Activity,
  Agency,
  AuditLog,
  Contact,
  Membership,
  Opportunity,
  Pipeline,
  Plan,
  Role,
  User,
} from '../../models';
import { agencyRouter } from './agency.routes';
import { authRouter } from './auth.routes';

const router = Router();

/**
 * An account-scoped caller may only act on the sub-account their permissions came from.
 *
 * Permissions are resolved against `X-Account-Id`, but these routes act on the `:id` in the
 * URL — and used to require only that the two shared an agency. So the admin of one client
 * could rename, pause or archive a sibling client, holding no role there at all.
 *
 * Agency and platform scope keep their reach: spanning sub-accounts is their job. A 404
 * rather than a 403, so the response does not confirm that the other account exists.
 */
function assertAccountTarget(ctx: TenantContext, targetId: string | undefined) {
  if (ctx.scope === 'account' && targetId !== ctx.accountId) throw notFound('Sub-account');
}

router.use('/auth', authRouter);

// Agency console. Mounted before the account-scoped routes below because its own
// middleware establishes agency context instead of requiring an X-Account-Id.
router.use('/agency', authenticate, agencyRouter);

/**
 * Confirm a sending address from the link mailed to it.
 *
 * Lives here rather than in the email module because it has to be reachable with no
 * session at all — the person opening the link is whoever reads that mailbox, who may not
 * be a CRM user — and every email route sits behind authentication and the module gate.
 *
 * The lookup itself is `confirmSenderToken`, which is where the reasoning for stepping
 * outside tenant scoping lives.
 */
router.post(
  '/sender-verification',
  verifyByIp,
  handler(async (req, res) => {
    const { token } = z.object({ token: z.string().min(1).max(200) }).parse(req.body);

    const confirmed = await confirmSenderToken(token);

    // Identical for "no such token" and "expired", as with invites.
    if (!confirmed) throw badRequest('This confirmation link is invalid or has expired.');

    res.json(confirmed);
  }),
);

/** The module catalog, for the settings UI and the plan builder. */
router.get('/modules', authenticate, (_req, res) => {
  res.json({ data: listModules() });
});

// ── Sub-accounts ────────────────────────────────────────────────────────────

router.get(
  '/accounts',
  authenticate,
  handler(async (req, res) => {
    // Scoped by membership rather than by the tenancy plugin: this endpoint spans
    // sub-accounts, so it runs before a single account is selected.
    const memberships = await loadMemberships(req.userId!);

    const accountIds = memberships
      .filter((m) => m.scope === 'account')
      .map((m) => m.accountId as string);
    const agencyIds = memberships
      .filter((m) => m.scope === 'agency')
      .map((m) => m.agencyId as string);

    const accounts = await Account.find({
      $or: [{ _id: { $in: accountIds } }, { agencyId: { $in: agencyIds } }],
    }).sort({ name: 1 });

    res.json({ data: accounts });
  }),
);

const createAccountSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Slug may contain lowercase letters, numbers and hyphens only'),
  timezone: z.string().default('America/Denver'),
  markets: z.array(z.string()).default([]),
  enabledModules: z.array(z.string()).default(['core', 'contacts']),
});

router.post(
  '/accounts',
  authenticate,
  resolveTenant,
  requirePermission('core:account:create'),
  handler(async (req, res) => {
    const input = createAccountSchema.parse(req.body);
    const ctx = req.tenant!;

    const agency = await Agency.findById(ctx.agencyId);
    if (!agency) throw notFound('Agency');

    const plan = await Plan.findById(agency.planId);
    const existing = await Account.countDocuments({ agencyId: ctx.agencyId });

    const accountLimit = plan?.limits?.accounts;
    if (accountLimit !== undefined && existing >= accountLimit) {
      throw forbidden(`Your plan allows ${accountLimit} sub-accounts. Upgrade to add more.`);
    }

    // A new sub-account can never start with more than its agency sells.
    const requested = withDependencies(input.enabledModules as ModuleKey[]);
    const allowed = requested.filter(
      (k) => agency.enabledModules.includes(k) || getModule(k)?.core,
    );

    const account = await Account.create({
      ...input,
      enabledModules: allowed,
      agencyId: ctx.agencyId,
      moduleGrants: [],
      moduleDenies: [],
    });

    await AuditLog.create({
      agencyId: ctx.agencyId,
      accountId: String(account._id),
      userId: ctx.userId,
      action: 'account.create',
      entity: 'Account',
      entityId: String(account._id),
      after: account.toJSON(),
      ip: req.ip,
    });

    res.status(201).json(account);
  }),
);

router.get(
  '/accounts/:id',
  authenticate,
  resolveTenant,
  requirePermission('core:account:read'),
  handler(async (req, res) => {
    assertAccountTarget(req.tenant!, req.params.id);

    const account = await Account.findOne({
      _id: req.params.id,
      agencyId: req.tenant!.agencyId,
    });
    if (!account) throw notFound('Sub-account');
    res.json(account);
  }),
);

const updateAccountSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  timezone: z.string().min(1).max(64).optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  markets: z.array(z.string().max(120)).max(50).optional(),
});

router.patch(
  '/accounts/:id',
  authenticate,
  resolveTenant,
  requirePermission('core:account:update', 'core:settings:update'),
  handler(async (req, res) => {
    const input = updateAccountSchema.parse(req.body);
    const ctx = req.tenant!;

    assertAccountTarget(ctx, req.params.id);

    // Pausing or archiving closes the sub-account to its own members, so it is the
    // agency's call. A member who could set it could also lock their whole team out.
    if (input.status !== undefined && ctx.scope === 'account') {
      throw forbidden('Only your agency can change the status of this sub-account');
    }

    // Scoped by agencyId as well as id — an account id from another agency must not
    // be editable just because the caller holds the permission in their own.
    const account = await Account.findOne({ _id: req.params.id, agencyId: ctx.agencyId });
    if (!account) throw notFound('Sub-account');

    const before = account.toJSON();
    Object.assign(account, input);
    await account.save();

    await AuditLog.create({
      agencyId: ctx.agencyId,
      accountId: String(account._id),
      userId: ctx.userId,
      action: 'account.update',
      entity: 'Account',
      entityId: String(account._id),
      before,
      after: account.toJSON(),
      ip: req.ip,
    });

    res.json(account);
  }),
);

// ── Module toggles ──────────────────────────────────────────────────────────

const moduleToggleSchema = z.object({
  /**
   * May be empty. The settings screen lists only optional modules, so switching them all
   * off legitimately submits `[]` — a sub-account running the core CRM and nothing else.
   * Core modules are re-added below regardless, so an empty array can never strand one.
   */
  enabledModules: z.array(z.string()),
});

/**
 * Persist a sub-account's module set.
 *
 * Revalidates everything the UI already checked — the browser's copy of the rules is
 * advisory, and this endpoint is reachable directly.
 */
router.put(
  '/accounts/:id/modules',
  authenticate,
  resolveTenant,
  requirePermission('core:module:toggle'),
  handler(async (req, res) => {
    const { enabledModules } = moduleToggleSchema.parse(req.body);
    const ctx = req.tenant!;

    assertAccountTarget(ctx, req.params.id);

    const account = await Account.findOne({ _id: req.params.id, agencyId: ctx.agencyId });
    if (!account) throw notFound('Sub-account');

    const agency = await Agency.findById(ctx.agencyId);
    if (!agency) throw notFound('Agency');

    const submitted = enabledModules as ModuleKey[];

    const unknown = submitted.filter((k) => !getModule(k));
    if (unknown.length > 0) throw badRequest(`Unknown modules: ${unknown.join(', ')}`);

    /**
     * Core modules are always on and are re-added here rather than merely being ignored.
     *
     * `resolveModules` would put them back in the effective set anyway, but then the
     * stored array and the resolved one disagree — and the stored array is what the
     * settings screen reads back. Forcing them in keeps the database honest about what
     * the sub-account actually has.
     */
    const requested = [...new Set([...submitted, ...coreModules()])];

    // The agency ceiling, enforced server-side. Core modules sit outside it: they are
    // not sold, they are the product.
    const overCeiling = requested.filter(
      (k) => !agency.enabledModules.includes(k) && !getModule(k)?.core,
    );
    if (overCeiling.length > 0) {
      throw forbidden(
        `Your agency plan does not include: ${overCeiling
          .map((k) => getModule(k)?.name ?? k)
          .join(', ')}`,
      );
    }

    const validation = validateModuleSet(requested);
    if (!validation.valid) {
      throw badRequest('Module dependencies are not satisfied', validation.missing);
    }

    const before = [...account.enabledModules];
    account.enabledModules = requested;
    await account.save();

    await AuditLog.create({
      agencyId: ctx.agencyId,
      accountId: String(account._id),
      userId: ctx.userId,
      action: 'account.modules.update',
      entity: 'Account',
      entityId: String(account._id),
      before: { enabledModules: before },
      after: { enabledModules: requested },
      ip: req.ip,
    });

    res.json(account);
  }),
);

// ── Team ────────────────────────────────────────────────────────────────────

router.get(
  '/users',
  authenticate,
  resolveTenant,
  requirePermission('core:user:read'),
  handler(async (req, res) => {
    const ctx = req.tenant!;

    /**
     * Members of *this* sub-account only.
     *
     * Agency staff can reach every sub-account, but they are not part of any client's
     * team and listing them here misrepresents the client's own roster — the person
     * reading this screen wants to know who works on their account, not who at the
     * agency happens to have the keys. Agency reach is visible in the agency console.
     */
    const memberships = await Membership.find({
      scope: 'account',
      accountId: ctx.accountId,
      status: { $ne: 'suspended' },
    });

    const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } });
    const roles = await Role.find({ _id: { $in: memberships.map((m) => m.roleId) } });

    const roleById = new Map(roles.map((r) => [String(r._id), r]));
    const membershipByUser = new Map(memberships.map((m) => [String(m.userId), m]));

    res.json({
      data: users.map((u) => {
        const m = membershipByUser.get(String(u._id));
        return {
          id: String(u._id),
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          status: u.status,
          lastLoginAt: u.lastLoginAt,
          role: m ? roleById.get(String(m.roleId))?.name : undefined,
          scope: m?.scope,
          membershipId: m ? String(m._id) : undefined,
        };
      }),
    });
  }),
);

const inviteSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  roleId: z.string().min(1),
});

/**
 * Invite a user to the active sub-account.
 *
 * Creates the identity if this email is new to the platform, then attaches a membership.
 * A user who already exists keeps their password and simply gains access — one login
 * across every sub-account is the whole point of the identity/membership split.
 */
router.post(
  '/users/invite',
  authenticate,
  resolveTenant,
  requirePermission('core:user:invite'),
  handler(async (req, res) => {
    const input = inviteSchema.parse(req.body);
    const ctx = req.tenant!;

    const outcome = await inviteUserToScope({
      input,
      agencyId: ctx.agencyId,
      accountId: ctx.accountId,
      actorId: ctx.userId,
      ip: req.ip,
      // Handing out an agency role from inside one client's screen would silently grant
      // access to every other client.
      allowedScopes: ['account'],
      auditActions: { invite: 'user.invite', resend: 'user.invite_resend' },
    });

    res.status(outcome.resent ? 200 : 201).json(outcome);
  }),
);

router.get(
  '/roles',
  authenticate,
  resolveTenant,
  requirePermission('core:role:read'),
  handler(async (req, res) => {
    const roles = await Role.find({
      $or: [{ agencyId: req.tenant!.agencyId }, { agencyId: null }],
    });
    res.json({ data: roles });
  }),
);

// ── Custom roles ────────────────────────────────────────────────────────────

const roleBodySchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(300).default(''),
  scope: z.enum(['account', 'agency']),
  permissions: z.array(z.string()).max(500),
});

/**
 * Who may manage roles, and with what.
 *
 * A role belongs to the agency and applies in every sub-account that uses it, so editing
 * one from inside a single client would change what people can do in all the others. Role
 * management is therefore agency-level, whatever a membership's overrides say.
 *
 * And nobody can build a role stronger than themselves: every permission in it must be one
 * the caller holds. Otherwise "can edit roles" would quietly mean "can grant anything".
 */
function assertRolePermissions(ctx: TenantContext, permissions: string[]) {
  if (ctx.scope === 'account') {
    throw forbidden('Roles are managed by your agency');
  }

  const vocabulary = new Set(permissionVocabulary());
  const unknown = permissions.filter((p) => !vocabulary.has(p));
  if (unknown.length > 0) throw badRequest(`Unknown permissions: ${unknown.join(', ')}`);

  const beyond = permissions.filter((p) => !hasPermission(ctx.permissions, p));
  if (beyond.length > 0) {
    throw forbidden(`You cannot grant permissions you do not hold: ${beyond.join(', ')}`);
  }
}

/** A custom role of this agency, or a refusal that says why. */
async function editableRole(ctx: TenantContext, id: string | undefined) {
  const role = await Role.findOne({
    _id: id,
    $or: [{ agencyId: ctx.agencyId }, { agencyId: null }],
  });
  if (!role) throw notFound('Role');
  // System roles are shared by every agency; changing one here would change it for all.
  if (role.isSystem || !role.agencyId) {
    throw forbidden('Built-in roles cannot be changed. Create a custom role instead.');
  }
  return role;
}

router.post(
  '/roles',
  authenticate,
  resolveTenant,
  requirePermission('core:role:manage'),
  handler(async (req, res) => {
    const input = roleBodySchema.parse(req.body);
    const ctx = req.tenant!;

    assertRolePermissions(ctx, input.permissions);

    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!slug) throw badRequest('That name does not produce a usable role key');

    const role = await Role.create({
      ...input,
      permissions: [...new Set(input.permissions)],
      // Prefixed so a custom role can never take a built-in role's key.
      key: `custom_${slug}`,
      agencyId: ctx.agencyId,
      isSystem: false,
    });

    await AuditLog.create({
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      action: 'role.create',
      entity: 'Role',
      entityId: String(role._id),
      after: role.toJSON(),
      ip: req.ip,
    });

    res.status(201).json(role);
  }),
);

router.patch(
  '/roles/:id',
  authenticate,
  resolveTenant,
  requirePermission('core:role:manage'),
  handler(async (req, res) => {
    // Scope is fixed at creation: memberships using the role are scoped to match it.
    const input = roleBodySchema.omit({ scope: true }).partial().parse(req.body);
    const ctx = req.tenant!;

    assertRolePermissions(ctx, input.permissions ?? []);
    const role = await editableRole(ctx, req.params.id);

    const before = role.toJSON();
    if (input.name !== undefined) role.name = input.name;
    if (input.description !== undefined) role.description = input.description;
    if (input.permissions !== undefined) role.permissions = [...new Set(input.permissions)];
    await role.save();

    await AuditLog.create({
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      action: 'role.update',
      entity: 'Role',
      entityId: String(role._id),
      before,
      after: role.toJSON(),
      ip: req.ip,
    });

    res.json(role);
  }),
);

router.delete(
  '/roles/:id',
  authenticate,
  resolveTenant,
  requirePermission('core:role:manage'),
  handler(async (req, res) => {
    const ctx = req.tenant!;
    if (ctx.scope === 'account') throw forbidden('Roles are managed by your agency');

    const role = await editableRole(ctx, req.params.id);

    // Deleting a role people hold would leave them with memberships that resolve to
    // nothing — every request they made would fail with "Role not found".
    const holders = await Membership.countDocuments({ roleId: String(role._id) });
    if (holders > 0) {
      throw conflict(
        `${holders} ${holders === 1 ? 'person still has' : 'people still have'} this role. ` +
          'Move them to another role first.',
      );
    }

    await role.deleteOne();

    await AuditLog.create({
      agencyId: ctx.agencyId,
      userId: ctx.userId,
      action: 'role.delete',
      entity: 'Role',
      entityId: String(role._id),
      before: role.toJSON(),
      ip: req.ip,
    });

    res.status(204).end();
  }),
);

// ── Dashboard ───────────────────────────────────────────────────────────────

/**
 * Aggregates for the sub-account dashboard, in one round trip.
 *
 * Counts come from the tenant-scoped models, so the tenancy plugin restricts every figure
 * here to the active sub-account without this handler naming it.
 */
router.get(
  '/dashboard',
  authenticate,
  resolveTenant,
  handler(async (req, res) => {
    const ctx = req.tenant!;
    const enabled = new Set(ctx.enabledModules);

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    type PipelineSummary = {
      name: string;
      stages: { id: string; name: string; count: number; value: number; probability: number }[];
      openValue: number;
      weightedValue: number;
      openCount: number;
    };

    async function pipelineSummary(): Promise<PipelineSummary | null> {
      // The default pipeline, or failing that any pipeline: `isDefault` sorts first.
      const defaultPipeline = await Pipeline.findOne({}).sort({ isDefault: -1 });
      if (!defaultPipeline) return null;

      // Summed by the database rather than by loading every open card to add them up
      // here. The tenancy plugin prepends the tenant `$match` to the pipeline.
      const totals: { _id: string; count: number; value: number }[] = await Opportunity.aggregate([
        { $match: { pipelineId: String(defaultPipeline._id), status: 'open' } },
        { $group: { _id: '$stageId', count: { $sum: 1 }, value: { $sum: '$value' } } },
      ]);
      const byStage = new Map(totals.map((t) => [t._id, t]));

      const stages = defaultPipeline.stages
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((s) => ({
          id: s.id,
          name: s.name,
          probability: s.probability,
          count: byStage.get(s.id)?.count ?? 0,
          value: byStage.get(s.id)?.value ?? 0,
        }));

      return {
        name: defaultPipeline.name,
        stages,
        openCount: stages.reduce((sum, s) => sum + s.count, 0),
        openValue: stages.reduce((sum, s) => sum + s.value, 0),
        weightedValue: Math.round(
          stages.reduce((sum, s) => sum + s.value * (s.probability / 100), 0),
        ),
      };
    }

    // The three sections do not depend on one another, so they are asked for together —
    // the page waits for the slowest of them rather than for all of them in a row.
    const [[contactCount, qualifiedCount, newThisMonth], pipeline, activities] = await Promise.all([
      enabled.has('contacts')
        ? Promise.all([
            Contact.countDocuments({}),
            Contact.countDocuments({ status: 'qualified' }),
            Contact.countDocuments({ createdAt: { $gte: since } }),
          ])
        : [0, 0, 0],
      enabled.has('pipelines') ? pipelineSummary() : null,
      enabled.has('contacts') ? Activity.find({}).sort({ occurredAt: -1 }).limit(6) : [],
    ]);

    res.json({
      contacts: { total: contactCount, qualified: qualifiedCount, newThisMonth },
      pipeline,
      activities,
    });
  }),
);

// ── Global search ───────────────────────────────────────────────────────────

/**
 * Cross-entity search for the topbar.
 *
 * Only searches modules the sub-account actually has enabled, so a disabled module never
 * leaks records through the search box — the same rule the nav and the API gate apply.
 */
router.get(
  '/search',
  authenticate,
  resolveTenant,
  handler(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) {
      res.json({ contacts: [], opportunities: [] });
      return;
    }

    const ctx = req.tenant!;
    const enabled = new Set(ctx.enabledModules);
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(safe, 'i');

    const canContacts = enabled.has('contacts') && hasAnyPermission(ctx.permissions, ['contacts:contact:read']);
    const canPipelines =
      enabled.has('pipelines') && hasAnyPermission(ctx.permissions, ['pipelines:opportunity:read']);

    // Contacts are matched through their search tokens, which an index can answer; see
    // `modules/contacts/search.ts`. Opportunities are few per sub-account and keep the regex.
    const contactMatch = searchConditions(q);

    const [contacts, opportunities] = await Promise.all([
      canContacts && contactMatch.length > 0
        ? Contact.find({ $and: contactMatch })
            .select('firstName lastName email phone status property.county property.state')
            .limit(8)
        : [],
      canPipelines ? Opportunity.find({ name: rx }).select('name value stageId status').limit(5) : [],
    ]);

    res.json({ contacts, opportunities });
  }),
);

router.get(
  '/audit',
  authenticate,
  resolveTenant,
  requirePermission('core:audit:read'),
  handler(async (req, res) => {
    const logs = await AuditLog.find({
      agencyId: req.tenant!.agencyId,
      accountId: req.tenant!.accountId,
    })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ data: logs });
  }),
);

// Self-guarded: this module serves login and refresh, which cannot sit behind
// authentication, so each route below applies its own chain.
export const coreModule: ApiModule = { key: 'core', router, selfGuarded: true };
