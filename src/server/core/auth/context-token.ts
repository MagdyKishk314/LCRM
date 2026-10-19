import jwt from 'jsonwebtoken';
import type { ModuleKey, Permission } from '@/shared';
import { env } from '../../config/env';

/**
 * A signed record of a context the user has entered.
 *
 * Authenticating a request used to answer two questions from the database every time:
 * *who is this* (the user) and *what may they do here* (memberships, agency, plan, role —
 * four more documents, several of them read one after another). The second question has
 * the same answer for every request in a session, so it is answered **once**, when the
 * user enters an agency or a sub-account, and the answer is signed into this token. From
 * then on a request proves its context by presenting the token, and the API verifies a
 * signature instead of walking the tenancy tree.
 *
 * What the token settles, and therefore what can lag behind an admin's change until it is
 * reissued (every ten minutes, by the web middleware):
 *
 *   - which seat the user holds, and the permissions that seat resolves to;
 *   - the agency's standing and its module ceiling (plan ∩ agency).
 *
 * What it does *not* settle, and is still checked on every request:
 *
 *   - the user: existence and suspension (`authenticate`);
 *   - the sub-account: existence, status and its own module toggles (`resolveTenant`
 *     reads it through the record cache). Pausing a sub-account or switching a module off
 *     for it takes effect at once.
 *
 * It can only ever narrow. The token is signed with the server's secret, names the user it
 * was issued to, and is matched against the sub-account being requested; a token for one
 * context grants nothing in another.
 */
export interface ContextClaims {
  /** The user it was issued to; must match the access token presented with it. */
  sub: string;
  kind: 'ctx';
  /** The seat that resolved. Platform seats are not tokenised — they carry no agency. */
  scope: 'agency' | 'account';
  agencyId: string;
  /** Set for an account seat only; an agency seat reaches every sub-account beneath it. */
  accountId?: string;
  /** The agency ceiling, already resolved: what any sub-account beneath it may enable. */
  modules: ModuleKey[];
  permissions: Permission[];
  /**
   * The choice the user made at login — `agency`, or `account:<id>` — kept so a reissue
   * honours it. See `pickMembership`.
   */
  hint?: string;
}

export const CONTEXT_TOKEN_TTL_SECONDS = 10 * 60;

export function signContextToken(claims: ContextClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: CONTEXT_TOKEN_TTL_SECONDS });
}

/**
 * The claims, or `null` for anything that is not a valid, unexpired context token.
 *
 * Never throws: a request without a usable token is not an error, it is simply resolved
 * the long way.
 */
export function verifyContextToken(token: string | undefined): ContextClaims | null {
  if (!token || !looksLikeJwt(token)) return null;
  try {
    const claims = jwt.verify(token, env.JWT_ACCESS_SECRET) as Partial<ContextClaims>;
    if (claims.kind !== 'ctx' || !claims.sub || !claims.agencyId) return null;
    return claims as ContextClaims;
  } catch {
    return null;
  }
}

/** The web layer sent the bare hint (`agency`, `account:<id>`) in this header before tokens. */
export function looksLikeJwt(value: string): boolean {
  return value.split('.').length === 3;
}
