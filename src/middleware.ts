import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  CONTEXT_COOKIE,
  CONTEXT_MAX_AGE,
  REFRESH_COOKIE,
  cookieOptions,
  decodeToken,
  needsRefresh,
  type ContextCookieClaims,
} from '@/lib/api/cookies';

/**
 * Same resolution as `lib/api/client`, duplicated because the middleware runs on the edge
 * runtime and must not import server-only modules.
 */
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

/**
 * Guards the app and keeps both tokens fresh.
 *
 * Refresh happens here rather than in a server component because only middleware and
 * route handlers can set cookies on the response. With a 15-minute access token, doing
 * this any later would mean a user hitting an expired token mid-session.
 *
 * The context token (see `cookies.ts`) is kept current the same way: reissued before it
 * expires, and whenever the URL is for a context it does not cover — an agency owner
 * stepping from the console into a sub-account, say. The page that follows then presents
 * a token the API can verify instead of resolving the seat from the database.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;

  // Already signed in and heading to /login — send them into the app instead.
  if (pathname === '/login') {
    if (access && !needsRefresh(access)) {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return NextResponse.next();
  }

  const next = NextResponse.next();

  if (needsRefresh(access)) {
    // Access token is missing or about to expire. Without a refresh token there is
    // nothing to recover from.
    if (!refresh) return toLogin(req, pathname + search);

    try {
      const res = await fetch(`${API_URL}/api/v1/core/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });

      if (!res.ok) return toLogin(req, pathname + search);

      const { accessToken } = (await res.json()) as { accessToken?: string };
      if (!accessToken) return toLogin(req, pathname + search);

      access = accessToken;
      next.cookies.set(ACCESS_COOKIE, accessToken, { ...cookieOptions, maxAge: ACCESS_MAX_AGE });
    } catch {
      // API unreachable — fall through to the login screen rather than rendering a
      // shell that will fail on every data call.
      return toLogin(req, pathname + search);
    }
  }

  const wanted = contextFor(pathname);
  if (wanted && access) {
    const current = req.cookies.get(CONTEXT_COOKIE)?.value;
    if (!covers(current, wanted)) {
      const token = await issueContext(access, wanted, current);
      if (token) next.cookies.set(CONTEXT_COOKIE, token, { ...cookieOptions, maxAge: CONTEXT_MAX_AGE });
    }
  }

  return next;
}

type Wanted = { type: 'agency' } | { type: 'account'; accountId: string };

/** The context a URL is for, if it is inside one. */
function contextFor(pathname: string): Wanted | null {
  if (pathname === '/agency' || pathname.startsWith('/agency/')) return { type: 'agency' };
  const account = /^\/app\/([^/]+)/.exec(pathname)?.[1];
  return account ? { type: 'account', accountId: account } : null;
}

/** Does the token in hand speak for this context, with time to spare? */
function covers(token: string | undefined, wanted: Wanted): boolean {
  const claims = decodeToken<ContextCookieClaims>(token);
  if (!claims || claims.kind !== 'ctx' || needsRefresh(token)) return false;
  if (wanted.type === 'agency') return claims.scope === 'agency';
  // An agency seat reaches every sub-account beneath it; an account seat only its own.
  return claims.scope === 'agency' || claims.accountId === wanted.accountId;
}

/**
 * Ask the API for a context token. `null` when none was issued — a platform seat, a
 * context the user does not hold, or the API being unreachable; in every one of those
 * cases the page still works, resolved the long way.
 */
async function issueContext(access: string, wanted: Wanted, previous: string | undefined) {
  // The choice made at login travels with the token; a cookie from before tokens holds
  // the bare choice itself.
  const claims = decodeToken<ContextCookieClaims>(previous);
  const hint = claims?.hint ?? (previous && !previous.includes('.') ? previous : undefined);

  try {
    const res = await fetch(`${API_URL}/api/v1/core/auth/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
      body: JSON.stringify({ ...wanted, ...(hint ? { hint } : {}) }),
    });
    if (!res.ok) return null;
    const { token } = (await res.json()) as { token?: string | null };
    return token ?? null;
  } catch {
    return null;
  }
}

function toLogin(req: NextRequest, from: string) {
  const url = new URL('/login', req.url);
  if (from && from !== '/') url.searchParams.set('from', from);

  const res = NextResponse.redirect(url);
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  res.cookies.delete(CONTEXT_COOKIE);
  return res;
}

export const config = {
  matcher: ['/', '/login', '/choose', '/app/:path*', '/agency/:path*', '/profile'],
};
