import { cookies } from 'next/headers';
import { apiSend } from './server';
import {
  CONTEXT_COOKIE,
  CONTEXT_MAX_AGE,
  cookieOptions,
  decodeToken,
  type ContextCookieClaims,
} from './cookies';

/**
 * Context tokens, from the server side of the web app.
 *
 * Not a `'use server'` module on purpose: everything exported from one of those becomes
 * an endpoint the browser can call. These run inside server actions and route handlers
 * only, which is also the only place a cookie can be set.
 */

/** What `POST /core/auth/context` answers. */
export interface ContextGrant {
  token: string | null;
  scope: 'agency' | 'account' | 'platform';
  accountId: string | null;
  expiresAt: string | null;
}

export type ContextRequest =
  | { type: 'agency'; hint?: string }
  | { type: 'account'; accountId: string; hint?: string };

/**
 * Ask the API for a context token and keep it in the cookie.
 *
 * Returns the grant so a caller can tell a platform seat (no token) from a failure. The
 * cookie is left alone when nothing was issued: the API then resolves each request the
 * long way, which is slower but correct.
 */
export async function issueContext(request: ContextRequest): Promise<ContextGrant> {
  const grant = await apiSend<ContextGrant>('/core/auth/context', { method: 'POST', body: request });

  if (grant.token) {
    const store = await cookies();
    store.set(CONTEXT_COOKIE, grant.token, { ...cookieOptions, maxAge: CONTEXT_MAX_AGE });
  }
  return grant;
}

/**
 * Reissue the current context after a change that it settles — a role edit, say.
 *
 * Others holding the old answer see the change when their token is next reissued; the
 * person who made it should not have to wait for that.
 */
export async function refreshContext(): Promise<void> {
  const store = await cookies();
  const claims = decodeToken<ContextCookieClaims>(store.get(CONTEXT_COOKIE)?.value);
  if (!claims) return;

  await issueContext(
    claims.scope === 'account' && claims.accountId
      ? { type: 'account', accountId: claims.accountId, hint: claims.hint }
      : { type: 'agency', hint: claims.hint },
  ).catch(() => undefined);
}
