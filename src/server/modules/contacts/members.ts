import type { TenantContext } from '../../core/tenancy/context';
import { Membership, User } from '../../models';

/**
 * The people who can own a contact, be assigned a task, or hold an appointment in this
 * sub-account: its own members plus the agency staff who reach it.
 *
 * One lookup serves the owner dropdown, the owner validation on write, and the actor
 * names on history — the same list each time, so a name shown is always one that could
 * have been chosen.
 */
export interface Member {
  id: string;
  name: string;
  email: string;
}

export async function membersOf(ctx: Pick<TenantContext, 'agencyId' | 'accountId'>): Promise<Member[]> {
  const memberships = await Membership.find({
    status: 'active',
    $or: [
      { scope: 'account', accountId: ctx.accountId },
      { scope: 'agency', agencyId: ctx.agencyId },
    ],
  }).select('userId');

  const ids = [...new Set(memberships.map((m) => String(m.userId)))];
  if (ids.length === 0) return [];

  const users = await User.find({ _id: { $in: ids }, status: { $ne: 'suspended' } })
    .select('firstName lastName email')
    .sort({ firstName: 1, lastName: 1 })
    .lean();

  return users.map((u) => ({
    id: String(u._id),
    name: `${u.firstName} ${u.lastName}`.trim(),
    email: u.email,
  }));
}

/** `null` when the id names nobody who can act in this sub-account. */
export async function memberById(
  ctx: Pick<TenantContext, 'agencyId' | 'accountId'>,
  userId: string | null | undefined,
): Promise<Member | null> {
  if (!userId) return null;
  return (await membersOf(ctx)).find((m) => m.id === userId) ?? null;
}
