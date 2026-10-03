import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { AuditLog, Membership, Role, User, hashPassword } from '../../models';
import { badRequest, conflict, forbidden } from '../errors';
import { generateInvite, inviteUrl } from './invites';

/**
 * Inviting a user, in one place.
 *
 * Two routes offer this — the sub-account team screen and the agency console — and while
 * they were separate implementations they drifted: both rotated the invite token before
 * checking for an existing membership, so re-inviting a pending user destroyed the only
 * working link and then returned a conflict, stranding them. Fixing that meant fixing it
 * twice, which is exactly the kind of bug a second copy produces.
 *
 * The routes are now adapters: they decide who may call and which scopes are allowed,
 * then hand over. The rules that must never differ — how a token is issued, when a
 * re-invite is a resend rather than a conflict, what gets audited, and that the link is
 * returned exactly once — live here.
 */
export interface InviteInput {
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
}

export interface InviteOptions {
  input: InviteInput;
  agencyId: string;
  /** The sub-account being joined. Omit for an agency-wide seat. */
  accountId?: string;
  /** Who is inviting, for the audit trail. */
  actorId: string;
  ip?: string;
  /** Role scopes this caller is allowed to hand out. */
  allowedScopes: readonly ('account' | 'agency')[];
  /** Audit action names, so each surface stays recognisable in the log. */
  auditActions: { invite: string; resend: string };
}

export interface InviteOutcome {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  role: string;
  scope: string;
  membershipId: string;
  /**
   * Present only when a fresh link was issued, and only this once.
   *
   * An existing active user gaining access has a password already — handing them a
   * password-setting link would be a reset, which is a different and more sensitive
   * operation than an invite.
   */
  inviteUrl: string | null;
  inviteExpiresAt: Date | null;
  /** True when this reissued a link for someone who had not accepted yet. */
  resent: boolean;
}

/**
 * Load a role and confirm this agency may hand it out.
 *
 * Shared by every path that attaches a role to a person — inviting them, and changing the
 * role on a membership they already hold. The second of those used to skip the ownership
 * check, so a role id from another agency was accepted. A system role (no `agencyId`) is
 * available to everyone; a custom role only to the agency that made it.
 */
export async function assignableRole(
  roleId: string,
  agencyId: string,
  allowedScopes: readonly string[],
) {
  const role = await Role.findById(roleId);
  if (!role) throw badRequest('That role does not exist');
  if (role.agencyId && String(role.agencyId) !== agencyId) {
    throw forbidden('That role belongs to another agency');
  }
  // Handing out a wider-scoped role than the surface allows would silently grant access
  // beyond the sub-account the admin is looking at.
  if (!allowedScopes.includes(role.scope)) {
    throw badRequest(
      allowedScopes.length === 1 && allowedScopes[0] === 'account'
        ? 'Only sub-account roles can be assigned here'
        : 'That role cannot be assigned here',
    );
  }
  return role;
}

export async function inviteUserToScope(opts: InviteOptions): Promise<InviteOutcome> {
  const { input, agencyId, accountId, actorId, ip, allowedScopes, auditActions } = opts;

  const role = await assignableRole(input.roleId, agencyId, allowedScopes);
  if (role.scope === 'account' && !accountId) {
    throw badRequest('A sub-account role needs a sub-account');
  }

  const email = input.email.toLowerCase();
  let user = await User.findOne({ email });

  /**
   * Someone who already holds this access is a resend, not a duplicate.
   *
   * Checked before the token is touched. Rotating it first and then rejecting the request
   * invalidates the link the admin is still holding — the dead end invites exist to close.
   */
  if (user) {
    const existing = await Membership.findOne({
      userId: String(user._id),
      agencyId,
      scope: role.scope,
      ...(accountId ? { accountId } : {}),
    });

    if (existing) {
      if (user.status !== 'invited') {
        throw conflict(
          accountId
            ? 'That user already has access to this sub-account'
            : 'That user already has this access',
        );
      }

      const resend = generateInvite();
      user.inviteTokenHash = resend.hash;
      user.inviteExpiresAt = resend.expiresAt;
      await user.save();

      await AuditLog.create({
        agencyId,
        accountId,
        userId: actorId,
        action: auditActions.resend,
        entity: 'Membership',
        entityId: String(existing._id),
        after: { email: user.email, scope: role.scope, accountId },
        ip,
      });

      return {
        id: String(user._id),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
        role: role.name,
        scope: role.scope,
        membershipId: String(existing._id),
        inviteUrl: inviteUrl(env.APP_URL, resend.token),
        inviteExpiresAt: resend.expiresAt,
        resent: true,
      };
    }
  }

  /**
   * A new user has no password, so they get a one-time link to set one.
   *
   * The placeholder hash is unusable on purpose — until the invite is accepted there is no
   * password that works, and a blank or guessable one would be a live account meanwhile.
   */
  const invite = !user || user.status === 'invited' ? generateInvite() : null;

  if (!user) {
    user = await User.create({
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash: await hashPassword(randomUUID() + randomUUID()),
      status: 'invited',
      inviteTokenHash: invite!.hash,
      inviteExpiresAt: invite!.expiresAt,
    });
  } else if (invite) {
    // Pending from an earlier invite elsewhere: reissue rather than leaving them with a
    // link that may already have expired.
    user.inviteTokenHash = invite.hash;
    user.inviteExpiresAt = invite.expiresAt;
    await user.save();
  }

  const membership = await Membership.create({
    userId: String(user._id),
    scope: role.scope,
    agencyId,
    accountId,
    roleId: input.roleId,
    permissionOverrides: { grant: [], deny: [] },
    status: 'active',
  });

  await AuditLog.create({
    agencyId,
    accountId,
    userId: actorId,
    action: auditActions.invite,
    entity: 'Membership',
    entityId: String(membership._id),
    after: { email: user.email, role: role.name, scope: role.scope, accountId },
    ip,
  });

  return {
    id: String(user._id),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    status: user.status,
    role: role.name,
    scope: role.scope,
    membershipId: String(membership._id),
    inviteUrl: invite ? inviteUrl(env.APP_URL, invite.token) : null,
    inviteExpiresAt: invite?.expiresAt ?? null,
    resent: false,
  };
}

/** Pull the caller's IP for the audit trail without each route remembering to. */
export function actorIp(req: Request): string | undefined {
  return req.ip;
}
