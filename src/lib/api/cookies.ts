/**
 * Cookie names and JWT helpers shared by the middleware and the session route handlers.
 *
 * Kept free of `next/headers` so the middleware (edge runtime) can import it too.
 */

export const ACCESS_COOKIE = 'lc_at';
/**
 * The context the user is in — an agency console or a sub-account — as a token the API
 * issued when they entered it (`POST /core/auth/context`).
 *
 * The token settles which seat the user holds there and what it permits, so the API can
 * verify a signature on each request instead of re-reading the tenancy tree. It is sent as
 * `X-Context`, and `middleware.ts` reissues it before it expires or when the user moves
 * to a context it does not cover.
 *
 * It records the choice made at login too: entering as a sub-account user means
 * sub-account permissions, even when the same person is also an agency owner. That can
 * only ever *narrow* — the API ignores a context the user does not actually hold.
 */
export const CONTEXT_COOKIE = 'lc_ctx';
export const REFRESH_COOKIE = 'lc_rt';

export const ACCESS_MAX_AGE = 60 * 60; // Cookie outlives the 15m token; expiry is checked from the JWT itself.
export const CONTEXT_MAX_AGE = 60 * 60; // Likewise: the token's own `exp` (10m) is what counts.
export const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

/** What the API put in a context token. Mirrors `ContextClaims` on the server. */
export interface ContextCookieClaims {
  sub: string;
  kind: 'ctx';
  scope: 'agency' | 'account';
  agencyId: string;
  accountId?: string;
  hint?: string;
  exp?: number;
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

/**
 * Read a JWT's payload without verifying it.
 *
 * Only ever used to decide *when to refresh* and *which context to ask for* — the API
 * verifies the signature on every request, so a forged token read here buys nothing.
 */
export function decodeToken<T extends object>(token: string | undefined): T | null {
  const part = token?.split('.')[1];
  if (!part) return null;

  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function tokenExpiry(token: string): number | null {
  const payload = decodeToken<{ exp?: number }>(token);
  return typeof payload?.exp === 'number' ? payload.exp : null;
}

/** True when the token is missing, unreadable, or expires within `skewSeconds`. */
export function needsRefresh(token: string | undefined, skewSeconds = 60): boolean {
  if (!token) return true;
  const exp = tokenExpiry(token);
  if (exp === null) return true;
  return exp * 1000 - Date.now() < skewSeconds * 1000;
}
