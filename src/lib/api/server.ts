import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SessionContext } from '@/shared';
import { apiFetch, ApiError, type RequestOptions } from './client';
import { ACCESS_COOKIE, CONTEXT_COOKIE } from './cookies';

/**
 * Server-side API access.
 *
 * The access token is refreshed by `middleware.ts` before a request reaches any of this,
 * so these helpers can assume the cookie is fresh. A 401 here means the session is truly
 * gone, and the only useful response is to send the user back to sign in.
 */

export async function getAccessToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value;
}

/** The context chosen at login, forwarded so the API resolves the same membership. */
export async function getContext(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(CONTEXT_COOKIE)?.value;
}

export async function apiGet<T>(
  path: string,
  opts: Omit<RequestOptions, 'method' | 'token'> = {},
): Promise<T> {
  const [token, context] = await Promise.all([getAccessToken(), getContext()]);
  if (!token) redirect('/login');

  try {
    return await apiFetch<T>(path, { ...opts, method: 'GET', token, context });
  } catch (err) {
    if (err instanceof ApiError && err.isAuth) redirect('/login');
    throw err;
  }
}

/** Like `apiGet`, but a 403 yields `null` instead of throwing. */
export async function apiGetOptional<T>(
  path: string,
  opts: Omit<RequestOptions, 'method' | 'token'> = {},
): Promise<T | null> {
  try {
    return await apiGet<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError && (err.isForbidden || err.status === 404)) return null;
    throw err;
  }
}

/** Mutating call for use inside server actions. */
export async function apiSend<T>(
  path: string,
  opts: Omit<RequestOptions, 'token'> & { method: 'POST' | 'PATCH' | 'PUT' | 'DELETE' },
): Promise<T> {
  const [token, context] = await Promise.all([getAccessToken(), getContext()]);
  if (!token) redirect('/login');
  return apiFetch<T>(path, { ...opts, token, context });
}

/**
 * The session for one sub-account: identity, switchable accounts, resolved modules
 * and effective permissions. Every page in the shell renders from this.
 *
 * Memoised per request. The account layout asks for it to build the sidebar, and the page
 * inside asks again to check its own access — on a full page load those are the same
 * request, and the second call was a second trip through the whole session endpoint.
 */
export const getSession = cache(async (accountId: string): Promise<SessionContext> => {
  return apiGet<SessionContext>(
    `/core/auth/session?accountId=${encodeURIComponent(accountId)}`,
  );
});
