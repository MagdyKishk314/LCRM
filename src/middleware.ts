import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  cookieOptions,
  needsRefresh,
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
 * Guards the app and keeps the access token fresh.
 *
 * Refresh happens here rather than in a server component because only middleware and
 * route handlers can set cookies on the response. With a 15-minute access token, doing
 * this any later would mean a user hitting an expired token mid-session.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;

  // Already signed in and heading to /login — send them into the app instead.
  if (pathname === '/login') {
    if (access && !needsRefresh(access)) {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return NextResponse.next();
  }

  if (!needsRefresh(access)) return NextResponse.next();

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

    const next = NextResponse.next();
    next.cookies.set(ACCESS_COOKIE, accessToken, {
      ...cookieOptions,
      maxAge: ACCESS_MAX_AGE,
    });
    return next;
  } catch {
    // API unreachable — fall through to the login screen rather than rendering a
    // shell that will fail on every data call.
    return toLogin(req, pathname + search);
  }
}

function toLogin(req: NextRequest, from: string) {
  const url = new URL('/login', req.url);
  if (from && from !== '/') url.searchParams.set('from', from);

  const res = NextResponse.redirect(url);
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}

export const config = {
  matcher: ['/', '/login', '/choose', '/app/:path*', '/agency/:path*', '/profile'],
};
