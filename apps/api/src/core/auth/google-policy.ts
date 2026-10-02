import type { GoogleProfile } from './google';

/**
 * Who a verified Google account is allowed to sign in as.
 *
 * Pure on purpose. This is the security boundary of the whole feature — get it wrong and a
 * Google account takes over a CRM user — so it is a decision table under test rather than
 * branching threaded through a route handler with a database and a network in the way.
 */
export type GoogleDecision =
  /** A user already linked to this Google account. */
  | { action: 'sign_in'; userId: string }
  /** Email matches an active user; attach the identity on the way in. */
  | { action: 'link_and_sign_in'; userId: string }
  /** Email matches an outstanding invite; accepting it completes setup without a password. */
  | { action: 'accept_invite'; userId: string }
  /** Not allowed, with the reason kept for the audit trail. */
  | { action: 'refuse'; reason: GoogleRefusal; message: string };

export type GoogleRefusal =
  | 'email_unverified'
  | 'no_matching_user'
  | 'suspended'
  | 'identity_claimed';

/** The subset of a user this decision needs. */
export interface CandidateUser {
  id: string;
  email: string;
  status: 'active' | 'invited' | 'suspended';
}

export interface ResolveInput {
  profile: GoogleProfile;
  /** The user already carrying this provider subject, if any. */
  linked: CandidateUser | null;
  /** The user holding this email address, if any. */
  byEmail: CandidateUser | null;
}

/**
 * Deliberately identical wording for "no such user" and most other refusals.
 *
 * Anyone can attempt a Google sign-in, so a specific message would turn this endpoint into
 * a way to test which addresses hold CRM accounts.
 */
const NO_ACCESS =
  'That Google account is not connected to a LandCaller account. Ask your administrator for an invite.';

export function resolveGoogleIdentity(input: ResolveInput): GoogleDecision {
  const { profile, linked, byEmail } = input;

  /**
   * An unverified email is refused before anything else.
   *
   * This is the account-takeover route: an address Google never confirmed can be claimed by
   * anyone, and matching it against a CRM user would hand over that account. Google returns
   * false here for some Workspace and alias configurations, so it is a real case, not a
   * theoretical one — those users sign in with a password instead.
   */
  if (!profile.emailVerified) {
    return {
      action: 'refuse',
      reason: 'email_unverified',
      message:
        'Google has not verified the email address on that account, so it cannot be used to ' +
        'sign in. Use your password instead.',
    };
  }

  // An existing link wins outright: the subject, not the email, is the identity.
  if (linked) {
    if (linked.status === 'suspended') {
      return { action: 'refuse', reason: 'suspended', message: 'This account has been suspended' };
    }
    return { action: 'sign_in', userId: linked.id };
  }

  if (!byEmail) {
    return { action: 'refuse', reason: 'no_matching_user', message: NO_ACCESS };
  }

  if (byEmail.status === 'suspended') {
    return { action: 'refuse', reason: 'suspended', message: 'This account has been suspended' };
  }

  /**
   * The email matches a CRM user and Google vouches for it, so the two are the same person.
   *
   * Safe here specifically because an administrator chose that address when inviting them —
   * in this system the address *is* the identity. It would not be safe in a product where
   * anyone can create an account under any email.
   */
  if (byEmail.status === 'invited') {
    return { action: 'accept_invite', userId: byEmail.id };
  }
  return { action: 'link_and_sign_in', userId: byEmail.id };
}
