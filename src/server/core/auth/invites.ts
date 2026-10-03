import { createHash, randomBytes } from 'node:crypto';

/**
 * One-time invite tokens.
 *
 * A new user is created without a usable password, so something has to let them set one.
 * Emailing a link is the eventual path; until SMTP is configured the admin copies the
 * link and passes it on, which works the same way and needs no mail server.
 *
 * The raw token is returned exactly once, at creation. Only its SHA-256 hash is stored,
 * so a leaked database yields no working links — the same reasoning as password hashing,
 * and cheap to do. No salt is needed: the token is 32 random bytes, not a guessable
 * secret, so there is nothing for a rainbow table to precompute.
 */

export const INVITE_TTL_DAYS = 7;

export interface GeneratedInvite {
  /** Give this to the user, once. Never stored. */
  token: string;
  hash: string;
  expiresAt: Date;
}

export function generateInvite(): GeneratedInvite {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    hash: hashInviteToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
  };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Build the URL the user visits to choose a password. */
export function inviteUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/invite/${token}`;
}
