import { NextResponse } from 'next/server';
import { API_BASE } from '@/lib/api/client';
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  cookieOptions,
} from '@/lib/api/cookies';
import { OAUTH_STATE_COOKIE, decodeAttempt, stateMatches } from '@/lib/api/oauth-state';

/**
 * Where Google sends the browser back.
 *
 * Ends in exactly the same place as the password and invite routes: both tokens in httpOnly
 * cookies on this origin, and the browser never holding either. The only thing that differs
 * is how identity was proved.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const attempt = decodeAttempt(req.headers.get('cookie')?.match(cookiePattern())?.[1]);

  /** Every failure ends up back on the sign-in screen with a reason it can render. */
  const back = (error: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${error}`, url.origin));
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  };

  // Google reports a user who declined, or a misconfigured client, this way.
  const denied = url.searchParams.get('error');
  if (denied) return back(denied === 'access_denied' ? 'cancelled' : 'google_failed');

  const code = url.searchParams.get('code');
  if (!code) return back('google_failed');

  /**
   * The state check is what makes this callback trustworthy.
   *
   * Without it, anyone could send a victim's browser here with their own authorization code
   * and log that victim into the attacker's account — a login CSRF. The cookie proves this
   * browser started the sign-in that is now finishing.
   */
  if (!attempt) return back('expired');
  if (!stateMatches(attempt.state, url.searchParams.get('state'))) return back('state_mismatch');

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}/core/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier: attempt.verifier, nonce: attempt.nonce }),
    });
  } catch {
    return back('unreachable');
  }

  const payload = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    const message = (payload as { error?: { message?: string } })?.error?.message;
    // The API's message is the useful one — it distinguishes "not invited" from "suspended"
    // from "Google has not verified this address" — so it is carried rather than flattened.
    return back(message ? `google:${encodeURIComponent(message)}` : 'google_failed');
  }

  const { accessToken } = payload as { accessToken: string };

  /**
   * Straight to the root, not to a destination.
   *
   * The root already sends a single-membership user into their sub-account and everyone else
   * to `/choose`. Deciding that here would be a second copy of a rule that has to match.
   */
  const res = NextResponse.redirect(new URL('/', url.origin));

  res.cookies.set(ACCESS_COOKIE, accessToken, { ...cookieOptions, maxAge: ACCESS_MAX_AGE });

  const refreshToken = extractCookie(upstream, 'lc_refresh');
  if (refreshToken) {
    res.cookies.set(REFRESH_COOKIE, refreshToken, { ...cookieOptions, maxAge: REFRESH_MAX_AGE });
  }

  // Single use: the attempt is finished, whether or not it succeeded.
  res.cookies.delete(OAUTH_STATE_COOKIE);

  return res;
}

function cookiePattern(): RegExp {
  return new RegExp(`(?:^|;\\s*)${OAUTH_STATE_COOKIE}=([^;]+)`);
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
