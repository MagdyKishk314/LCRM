/**
 * Cookie names and JWT helpers shared by the middleware and the session route handlers.
 *
 * Kept free of `next/headers` so the middleware (edge runtime) can import it too.
 */

export const ACCESS_COOKIE = 'lc_at';
/**
 * Which context the user chose at login: `agency`, or `account:<id>`.
 *
 * One identity can hold several memberships. This records which one they picked so the
 * session resolves to that role and no other — entering as a sub-account user means
 * sub-account permissions, even when the same person is also an agency owner.
 *
 * Only ever *narrows*: the API ignores a context the user does not actually hold, so a
 * forged cookie cannot grant anything.
 */
export const CONTEXT_COOKIE = 'lc_ctx';
export const REFRESH_COOKIE = 'lc_rt';

export const ACCESS_MAX_AGE = 60 * 60; // Cookie outlives the 15m token; expiry is checked from the JWT itself.
export const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

/**
 * Read `exp` from a JWT without verifying it.
 *
 * Only ever used to decide *when to refresh* — the API verifies the signature on every
 * request, so a forged token read here buys nothing.
 */
export function tokenExpiry(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;

  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** True when the token is missing, unreadable, or expires within `skewSeconds`. */
export function needsRefresh(token: string | undefined, skewSeconds = 60): boolean {
  if (!token) return true;
  const exp = tokenExpiry(token);
  if (exp === null) return true;
  return exp * 1000 - Date.now() < skewSeconds * 1000;
}
