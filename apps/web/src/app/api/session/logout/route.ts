import { NextResponse, type NextRequest } from 'next/server';
import { API_BASE } from '@/lib/api/client';
import { ACCESS_COOKIE, CONTEXT_COOKIE, REFRESH_COOKIE } from '@/lib/api/cookies';

/**
 * Clear the session — here and on the API.
 *
 * Dropping the cookies only removes this browser's copy of the refresh token. The API is
 * told too, so it can revoke the token itself; otherwise a copy taken earlier would keep
 * working for the rest of its thirty days.
 *
 * Cookies are dropped locally regardless of what the API says — a user who clicks sign out
 * must end up signed out even if the API is unreachable.
 */
export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    try {
      await fetch(`${API_BASE}/core/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Unreachable API: the token expires on its own schedule. Still sign out locally.
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  // The chosen context belongs to the session that is ending, not to the next person
  // who signs in on this browser.
  res.cookies.delete(CONTEXT_COOKIE);
  return res;
}
