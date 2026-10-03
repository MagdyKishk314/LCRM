import { Router } from 'express';
import { z } from 'zod';
import {
  resolveModules,
  resolvePermissions,
  type ModuleKey,
  type Permission,
} from '@/shared';
import {
  authenticate,
  contextHint,
  loadAgency,
  loadPlan,
  loadRole,
  pickMembership,
} from '../../core/auth/middleware';
import { signAccessToken, verifyRefreshToken } from '../../core/auth/jwt';
import { REFRESH_COOKIE, issueSession } from '../../core/auth/session';
import { exchangeGoogleCode, googleAuthUrl, googleEnabled } from '../../core/auth/google';
import { resolveGoogleIdentity, type CandidateUser } from '../../core/auth/google-policy';
import { badRequest, forbidden, handler, notFound, unauthorized } from '../../core/errors';
import { hashInviteToken } from '../../core/auth/invites';
import {
  googleByIp,
  inviteByIp,
  loginByEmail,
  loginByIp,
  refreshByToken,
} from '../../core/rate-limit';
import { Account, AuditLog, Membership, User, hashPassword } from '../../models';

export const authRouter = Router();

/**
 * An audit write must never fail the sign-in it is recording — but it must not fail
 * silently either. These were swallowed with `.catch(() => undefined)`, which is how a
 * schema that rejected every "refused" entry went unnoticed.
 */
const auditFailed = (err: unknown) => {
  console.error('[audit] could not record auth event:', err instanceof Error ? err.message : err);
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  '/login',
  loginByIp,
  loginByEmail,
  handler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    // Password hash is `select: false`, so it must be asked for explicitly.
    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');

    // Same message and same work for "no such user" and "wrong password", so the
    // response cannot be used to enumerate which emails exist.
    if (!user || !(await (user as any).verifyPassword(password))) {
      throw unauthorized('Invalid email or password');
    }
    if (user.status === 'suspended') throw unauthorized('This account has been suspended');

    user.lastLoginAt = new Date();
    await user.save();

    res.json(issueSession(res, user));
  }),
);

authRouter.post(
  '/refresh',
  refreshByToken,
  handler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
    if (!token) throw unauthorized('No refresh token');

    const payload = verifyRefreshToken(token);
    const user = await User.findById(payload.sub);
    if (!user) throw unauthorized('User no longer exists');

    // A bumped counter means every token issued before it is dead.
    if ((user.tokenVersion ?? 0) !== payload.tv) {
      throw unauthorized('Session revoked, please sign in again');
    }
    // No fresh access token for a suspended user. `authenticate` would reject it anyway,
    // but there is no reason to keep minting them.
    if (user.status === 'suspended') throw unauthorized('This account has been suspended');

    res.json({
      accessToken: signAccessToken({ sub: String(user._id), email: user.email }),
    });
  }),
);

/**
 * Sign out, and make it stick.
 *
 * Clearing the cookie only removes this browser's copy of the refresh token. A copy taken
 * earlier — from a shared machine, a proxy log, a stolen laptop — stayed valid for the rest
 * of its thirty days. Bumping `tokenVersion` kills it.
 *
 * That ends the session on every device, not just this one: sessions are stateless, so there
 * is no per-device record to revoke. Signing in again elsewhere is the price of a sign-out
 * that actually signs out.
 *
 * Never fails. A missing, expired or already-revoked token means there is nothing left to
 * revoke, and the user must still end up signed out.
 */
authRouter.post(
  '/logout',
  handler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;

    if (typeof token === 'string') {
      try {
        const payload = verifyRefreshToken(token);
        // Conditional on the version the token carries, so replaying an old token after a
        // newer sign-in cannot be used to log that newer session out.
        await User.updateOne(
          { _id: payload.sub, tokenVersion: payload.tv },
          { $inc: { tokenVersion: 1 } },
        );
      } catch {
        // Nothing to revoke.
      }
    }

    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/core/auth' });
    res.json({ ok: true });
  }),
);

/**
 * Look up an invite without consuming it, so the page can greet the user by name and
 * fail early on an expired link rather than after they have chosen a password.
 */
authRouter.get(
  '/invite/:token',
  inviteByIp,
  handler(async (req, res) => {
    const user = await User.findOne({
      inviteTokenHash: hashInviteToken(req.params.token!),
      inviteExpiresAt: { $gt: new Date() },
    });

    // Deliberately identical for "no such token" and "expired": a probe should not learn
    // which it was, and neither answer helps the person holding a bad link.
    if (!user) throw badRequest('This invite link is invalid or has expired.');

    res.json({ email: user.email, firstName: user.firstName, lastName: user.lastName });
  }),
);

const acceptSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});

/**
 * Accept an invite: set the password, activate the account, sign the user in.
 *
 * Signing them in here rather than bouncing to the login screen means the link does the
 * whole job — the alternative is asking someone to type a password they set two seconds
 * ago.
 */
authRouter.post(
  '/invite/accept',
  inviteByIp,
  handler(async (req, res) => {
    const { token, password } = acceptSchema.parse(req.body);

    const user = await User.findOne({
      inviteTokenHash: hashInviteToken(token),
      inviteExpiresAt: { $gt: new Date() },
    });
    if (!user) throw badRequest('This invite link is invalid or has expired.');

    user.passwordHash = await hashPassword(password);
    user.status = 'active';
    // Single use: clearing these makes the link dead the moment it works.
    user.inviteTokenHash = undefined;
    user.inviteExpiresAt = undefined;
    user.lastLoginAt = new Date();
    await user.save();

    res.json(issueSession(res, user));
  }),
);


const googleUrlSchema = z.object({
  state: z.string().min(1),
  codeChallenge: z.string().min(1),
  nonce: z.string().min(1),
});

/**
 * Build the authorization URL the browser is sent to.
 *
 * Here rather than in the web app so the client id, the scopes and the redirect URI have a
 * single owner — the web app supplies only the per-attempt secrets it is holding.
 */
authRouter.post(
  '/google/url',
  googleByIp,
  handler(async (req, res) => {
    const input = googleUrlSchema.parse(req.body);
    res.json({ url: googleAuthUrl(input.state, input.codeChallenge, input.nonce) });
  }),
);

const googleSchema = z.object({
  code: z.string().min(1),
  codeVerifier: z.string().min(1),
  nonce: z.string().min(1),
});

/** Narrow a user document to what the policy decision is allowed to see. */
function candidate(user: { _id: unknown; email: string; status: string }): CandidateUser {
  return {
    id: String(user._id),
    email: user.email,
    status: user.status as CandidateUser['status'],
  };
}

/**
 * Sign in with Google.
 *
 * Proof of identity only — the session it ends in is the same one a password produces, via
 * `issueSession`. No user is ever created here: this is a closed CRM where an administrator
 * invites people, and provisioning on first sign-in would mean anyone with a Google account
 * has a login.
 */
authRouter.post(
  '/google',
  googleByIp,
  handler(async (req, res) => {
    const { code, codeVerifier, nonce } = googleSchema.parse(req.body);

    const profile = await exchangeGoogleCode(code, codeVerifier, nonce);

    const [linked, byEmail] = await Promise.all([
      User.findOne({ 'identities.provider': 'google', 'identities.subject': profile.subject }),
      User.findOne({ email: profile.email }),
    ]);

    const decision = resolveGoogleIdentity({
      profile,
      linked: linked ? candidate(linked) : null,
      byEmail: byEmail ? candidate(byEmail) : null,
    });

    if (decision.action === 'refuse') {
      // Audited without a tenant or an actor: there may be no account to attribute this
      // to, nobody is signed in, and a pattern of refusals is exactly what is worth being
      // able to see later.
      await AuditLog.create({
        agencyId: 'system',
        action: 'auth.google.refused',
        entity: 'User',
        entityId: byEmail ? String(byEmail._id) : 'unknown',
        after: { email: profile.email, reason: decision.reason },
        ip: req.ip,
      }).catch(auditFailed);

      throw unauthorized(decision.message);
    }

    const user = decision.action === 'sign_in' ? linked! : byEmail!;

    if (decision.action === 'accept_invite') {
      /**
       * Google settles the invite outright: it proves the address, which is what the emailed
       * link exists to do. Clearing the token keeps it single-use exactly as accepting with a
       * password does, so the link cannot then be reused by anyone else who received it.
       */
      user.status = 'active';
      user.inviteTokenHash = undefined;
      user.inviteExpiresAt = undefined;

      // An invited user carries only the unusable placeholder hash; dropping it makes the
      // account honestly provider-only rather than holding a password nobody can ever use.
      user.set('passwordHash', undefined);
    }

    if (decision.action !== 'sign_in') {
      user.identities.push({
        provider: 'google',
        subject: profile.subject,
        email: profile.email,
        linkedAt: new Date(),
      });
    }

    // Names come from the invite or the admin who created the user; Google only fills gaps.
    if (!user.firstName && profile.firstName) user.firstName = profile.firstName;
    if (!user.lastName && profile.lastName) user.lastName = profile.lastName;

    user.lastLoginAt = new Date();
    await user.save();

    if (decision.action !== 'sign_in') {
      await AuditLog.create({
        agencyId: 'system',
        userId: String(user._id),
        action:
          decision.action === 'accept_invite'
            ? 'auth.google.invite_accepted'
            : 'auth.google.linked',
        entity: 'User',
        entityId: String(user._id),
        after: { email: profile.email, subject: profile.subject },
        ip: req.ip,
      }).catch(auditFailed);
    }

    res.json(issueSession(res, user));
  }),
);

/** Whether the provider is configured, so the sign-in screen knows whether to offer it. */
authRouter.get('/providers', (_req, res) => {
  res.json({ google: googleEnabled() });
});


/**
 * The current user's linked sign-in providers, and whether they have a password.
 *
 * `hasPassword` is what the UI needs to decide whether unlinking is safe to offer — it is a
 * boolean about the caller's own account, not a secret.
 */
authRouter.get(
  '/identities',
  authenticate,
  handler(async (req, res) => {
    const user = await User.findById(req.userId!).select('+passwordHash');
    if (!user) throw unauthorized('User no longer exists');

    res.json({
      hasPassword: Boolean(user.passwordHash),
      identities: user.identities.map((i) => ({
        provider: i.provider,
        email: i.email,
        linkedAt: i.linkedAt,
      })),
    });
  }),
);

/**
 * Unlink a provider.
 *
 * Refused when it would leave the account with no way in — a provider-only user who unlinks
 * their last identity locks themselves out permanently, and there is no self-serve recovery
 * in a CRM where accounts are created by invitation.
 *
 * Unlinking bumps `tokenVersion`, so any session established through that provider dies with
 * it rather than outliving the link by up to thirty days.
 */
authRouter.delete(
  '/identities/:provider',
  authenticate,
  handler(async (req, res) => {
    const provider = req.params.provider;

    const user = await User.findById(req.userId!).select('+passwordHash');
    if (!user) throw unauthorized('User no longer exists');

    const linked = user.identities.find((i) => i.provider === provider);
    if (!linked) throw notFound('Linked account');

    const others = user.identities.filter((i) => i.provider !== provider);
    if (others.length === 0 && !user.passwordHash) {
      throw badRequest(
        `Set a password before unlinking ${provider} — it is currently the only way to sign in ` +
          'to this account.',
      );
    }

    user.set('identities', others);
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();

    await AuditLog.create({
      agencyId: 'system',
      userId: String(user._id),
      action: 'auth.google.unlinked',
      entity: 'User',
      entityId: String(user._id),
      before: { provider, email: linked.email },
      ip: req.ip,
    }).catch(auditFailed);

    res.json({ ok: true });
  }),
);

/** A lean record in the shape `toJSON` gives a document: `id`, no `_id`, no `__v`. */
function publicRecord<T extends { _id: unknown }>(record: T): Omit<T, '_id'> & { id: string } {
  const { _id, __v: _version, ...rest } = record as T & { __v?: unknown };
  return { ...rest, id: String(_id) } as Omit<T, '_id'> & { id: string };
}

/**
 * The session payload the web app's shell is built from: identity, every switchable
 * sub-account, and the resolved module set + permissions for the active one.
 *
 * Deliberately one round trip — the shell cannot render without all of it.
 */
authRouter.get(
  '/session',
  authenticate,
  handler(async (req, res) => {
    // Loaded by `authenticate`; not fetched a second time.
    const user = req.user;
    if (!user) throw unauthorized();

    const memberships = await Membership.find({ userId: req.userId, status: 'active' });

    /**
     * Whether this person can use the agency console at all.
     *
     * Derived from their memberships rather than from `scope` below, which describes the
     * *active sub-account* and therefore says nothing when an agency has no sub-accounts
     * yet — exactly when its owner most needs the console, to create the first one.
     */
    const hasAgencyAccess = memberships.some(
      (m) => m.scope === 'agency' || m.scope === 'platform',
    );

    /**
     * The context this request is actually running in.
     *
     * Set below from the membership that resolved, not from the requested hint: a hint
     * naming one sub-account does not apply while viewing another, and reporting it
     * anyway would hide agency affordances from someone operating with full agency
     * authority. Someone who *did* choose to enter as a sub-account member sees no agency
     * affordances — offering a door they deliberately declined is just confusing.
     */
    let activeContext: 'agency' | 'account' = hasAgencyAccess ? 'agency' : 'account';

    const agencyIds = [...new Set(memberships.map((m) => m.agencyId).filter(Boolean))] as string[];
    const accountScopedIds = memberships
      .filter((m) => m.scope === 'account' && m.accountId)
      .map((m) => m.accountId as string);

    // An agency membership implies access to every sub-account beneath it, so the
    // switcher lists those too rather than only accounts with an explicit membership.
    const agencyScopedAgencyIds = memberships
      .filter((m) => m.scope === 'agency' && m.agencyId)
      .map((m) => m.agencyId as string);

    const roleIds = [...new Set(memberships.map((m) => String(m.roleId)))];

    /**
     * Everything the memberships point at, fetched together.
     *
     * These ran one after another — accounts, then agencies, then roles, then the plan —
     * and every page load paid for the whole chain against a database a hundred-odd
     * milliseconds away. Agencies, roles and plans come through the record cache, so on a
     * warm instance only the account list actually leaves the process.
     */
    const [reachable, agencyList, roleList] = await Promise.all([
      Account.find({
        $or: [
          { _id: { $in: accountScopedIds } },
          { agencyId: { $in: agencyScopedAgencyIds } },
        ],
      }).sort({ name: 1 }),
      Promise.all(agencyIds.map(loadAgency)),
      Promise.all(roleIds.map(loadRole)),
    ]);

    const agencyById = new Map(
      agencyList.filter((a) => a !== null).map((a) => [String(a._id), a]),
    );
    const roleById = new Map(roleList.filter((r) => r !== null).map((r) => [String(r._id), r]));

    // Same rule as `resolveTenant`: a paused or archived sub-account is closed to its own
    // members, so it is not offered to them either — listing it would be a door that 403s.
    // Agency staff keep it, since they are the ones who can reactivate it.
    const agencyReach = new Set(agencyScopedAgencyIds);
    const accounts = reachable.filter(
      (a) => a.status === 'active' || agencyReach.has(String(a.agencyId)),
    );

    /**
     * Every place this login can land, in the GoHighLevel sense.
     *
     * One email may hold several memberships — agency staff on weekdays, a seat in a
     * client's sub-account for a side project. Each is a genuinely different context with
     * different data and permissions, so the user picks rather than being dropped into
     * whichever sorts first.
     *
     * Built from memberships, not from reachable accounts: an agency owner can reach
     * every sub-account, but that is one destination (the console), not forty.
     */
    const accountMemberships = memberships.filter((m) => m.scope === 'account' && m.accountId);
    const accountsById = new Map(accounts.map((a) => [String(a._id), a]));

    const destinations = [
      ...(hasAgencyAccess
        ? [
            {
              type: 'agency' as const,
              id: agencyIds[0] ?? null,
              name: agencyById.get(agencyIds[0] ?? '')?.name ?? 'Agency',
              roleName: 'Agency',
              href: '/agency',
            },
          ]
        : []),
      ...accountMemberships.flatMap((m) => {
        const account = accountsById.get(String(m.accountId));
        if (!account) return [];
        return [
          {
            type: 'account' as const,
            id: String(account._id),
            name: account.name,
            roleName: roleById.get(String(m.roleId))?.name ?? 'Member',
            href: `/app/${String(account._id)}`,
          },
        ];
      }),
    ];

    const requestedId = req.query.accountId as string | undefined;

    // An explicit request for a sub-account the user is not a member of must fail, not
    // quietly fall back to their first one — otherwise /app/<other-account> renders
    // somebody else's account name in the URL bar and 500s on the first data call.
    if (requestedId && !accounts.some((a) => String(a._id) === requestedId)) {
      throw forbidden('You do not have access to this sub-account');
    }

    const active = requestedId
      ? accounts.find((a) => String(a._id) === requestedId)
      : accounts[0];

    let enabledModules: ModuleKey[] = [];
    let permissions: Permission[] = [];
    let scope: string = 'account';
    let activeAgency: Awaited<ReturnType<typeof loadAgency>> = null;

    if (active) {
      activeAgency =
        agencyById.get(String(active.agencyId)) ?? (await loadAgency(String(active.agencyId)));

      // Same rule as resolveTenant — otherwise the shell would render one set of
      // permissions while the API enforced another.
      const membership = pickMembership(
        memberships.filter(
          (m) =>
            (m.scope === 'account' && String(m.accountId) === String(active._id)) ||
            (m.scope === 'agency' && String(m.agencyId) === String(active.agencyId)) ||
            m.scope === 'platform',
        ),
        contextHint(req),
        String(active._id),
      );

      if (membership && activeAgency) {
        // The role is already in hand; the plan is cached after the first request.
        const role = roleById.get(String(membership.roleId));
        const plan = await loadPlan(String(activeAgency.planId));

        scope = membership.scope;
        activeContext = membership.scope === 'account' ? 'account' : 'agency';
        enabledModules = resolveModules({
          planModules: (plan?.modules ?? []) as ModuleKey[],
          agency: {
            enabled: activeAgency.enabledModules as ModuleKey[],
            grants: activeAgency.moduleGrants as ModuleKey[],
            denies: activeAgency.moduleDenies as ModuleKey[],
          },
          account: {
            enabled: active.enabledModules as ModuleKey[],
            grants: active.moduleGrants as ModuleKey[],
            denies: active.moduleDenies as ModuleKey[],
          },
        });
        permissions = resolvePermissions({
          rolePermissions: (role?.permissions ?? []) as Permission[],
          grant: membership.permissionOverrides?.grant as Permission[] | undefined,
          deny: membership.permissionOverrides?.deny as Permission[] | undefined,
        });
      }
    }

    res.json({
      user: {
        id: String(user._id),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
        mfaEnabled: user.mfaEnabled,
      },
      accounts: accounts.map((a) => ({
        id: String(a._id),
        name: a.name,
        agencyId: String(a.agencyId),
        agencyName: agencyById.get(String(a.agencyId))?.name ?? '',
      })),
      // A cached, lean record: given the `id` shape every other response has.
      activeAgency: activeAgency ? publicRecord(activeAgency) : null,
      activeAccount: active ?? null,
      enabledModules,
      permissions,
      scope,
      hasAgencyAccess,
      activeContext,
      destinations,
    });
  }),
);
