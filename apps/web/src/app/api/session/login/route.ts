import { NextResponse } from 'next/server';
import { API_BASE } from '@/lib/api/client';
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  cookieOptions,
} from '@/lib/api/cookies';

interface LoginResult {
  accessToken: string;
  user: { id: string; email: string; firstName: string; lastName: string };
}

/**
 * Exchange credentials for cookies.
 *
 * The browser never sees either token: this runs on the Next server, calls Express, and
 * stores both tokens in httpOnly cookies on the Next origin. Express also sets its own
 * refresh cookie, but that is scoped to the API origin and never reaches us on later
 * server-to-server calls, so we lift it out of the Set-Cookie header here.
 */
export async function POST(req: Request) {
  let body: { email?: string; password?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  // Called directly rather than through apiFetch so the response headers stay reachable.
  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}/core/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The API rate-limits sign-in by address as well as by account. This call is
        // server-to-server, so without passing the caller's address along every attempt
        // would appear to come from this server.
        ...forwardedFor(req),
      },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the server. Please try again.' },
      { status: 503 },
    );
  }

  const payload = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    const message =
      (payload as { error?: { message?: string } })?.error?.message ?? 'Sign in failed';
    return NextResponse.json({ error: message }, { status: upstream.status });
  }

  const { accessToken, user } = payload as LoginResult;
  const refreshToken = extractCookie(upstream, 'lc_refresh');

  const res = NextResponse.json({ user });
  res.cookies.set(ACCESS_COOKIE, accessToken, { ...cookieOptions, maxAge: ACCESS_MAX_AGE });
  if (refreshToken) {
    res.cookies.set(REFRESH_COOKIE, refreshToken, {
      ...cookieOptions,
      maxAge: REFRESH_MAX_AGE,
    });
  }

  return res;
}

/** The original caller's address, in the header a proxy would have set. */
function forwardedFor(req: Request): Record<string, string> {
  const chain = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip');
  return chain ? { 'X-Forwarded-For': chain } : {};
}

/** Pull one cookie value out of a response's Set-Cookie headers. */
function extractCookie(res: Response, name: string): string | null {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];

  for (const header of all) {
    const [pair] = header.split(';');
    const eq = pair?.indexOf('=') ?? -1;
    if (eq === -1 || !pair) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return null;
}
