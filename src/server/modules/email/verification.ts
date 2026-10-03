import { hashInviteToken } from '../../core/auth/invites';
import { EmailIdentity } from '../../models';

/**
 * Confirm a sending address from the token mailed to it.
 *
 * The one place the email module steps outside tenant scoping, kept in a file of its own so
 * that the exception is this function and nothing else.
 *
 * It has to: the person opening the link has no session, so there is no tenant to scope to
 * until the identity the token names has been found. The token is the whole credential —
 * 32 random bytes, stored only as a hash, valid for seven days — and the lookup can return
 * at most the one identity it was issued for.
 *
 * Single use: the hash is cleared in the same write that marks the address verified, so
 * two requests racing on one link cannot both succeed.
 */
export async function confirmSenderToken(
  token: string,
): Promise<{ fromEmail: string; fromName: string } | null> {
  const identity = await EmailIdentity.findOneAndUpdate(
    { verifyTokenHash: hashInviteToken(token), verifyExpiresAt: { $gt: new Date() } },
    { $set: { verified: true }, $unset: { verifyTokenHash: 1, verifyExpiresAt: 1 } },
    { new: true },
  ).setOptions({ bypassTenantScope: true });

  return identity ? { fromEmail: identity.fromEmail, fromName: identity.fromName } : null;
}
