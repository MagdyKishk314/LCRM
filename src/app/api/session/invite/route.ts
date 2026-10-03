import { NextResponse } from 'next/server';
import { API_BASE } from '@/lib/api/client';
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  cookieOptions,
} from '@/lib/api/cookies';

/**
 * Accept an invite and start a session.
 *
 * Mirrors the login route: the API is called server-side and both tokens land in httpOnly
 * cookies, so the browser never holds them. Accepting signs the user straight in — asking
 * someone to re-type a password they chose a second ago is friction for nothing.
 */
export async function POST(req: Request) {
  let body: { token?: string; password?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!body.token || !body.password) {
    return NextResponse.json({ error: 'Token and password are required' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}/core/auth/invite/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
      (payload as { error?: { message?: string } })?.error?.message ?? 'Could not set your password';
    return NextResponse.json({ error: message }, { status: upstream.status });
  }

  const { accessToken, user } = payload as { accessToken: string; user: unknown };
  const refreshToken = extractCookie(upstream, 'lc_refresh');

  const res = NextResponse.json({ user });
  res.cookies.set(ACCESS_COOKIE, accessToken, { ...cookieOptions, maxAge: ACCESS_MAX_AGE });
  if (refreshToken) {
    res.cookies.set(REFRESH_COOKIE, refreshToken, { ...cookieOptions, maxAge: REFRESH_MAX_AGE });
  }

  return res;
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
