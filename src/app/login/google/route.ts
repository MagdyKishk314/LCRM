import { NextResponse } from 'next/server';
import { API_BASE } from '@/lib/api/client';
import { cookieOptions } from '@/lib/api/cookies';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE,
  codeChallenge,
  createAttempt,
  encodeAttempt,
} from '@/lib/api/oauth-state';

/**
 * Start a Google sign-in.
 *
 * A GET that redirects, because it is reached from a plain link — the browser has to leave
 * for Google, so there is nothing for JavaScript to do here.
 *
 * The authorization URL is built by the API, which owns the client id and the redirect URI.
 * The per-attempt secrets are minted here and kept in a cookie, because only this side of
 * the round trip sees the browser again when Google sends it back.
 */
export async function GET() {
  const attempt = createAttempt();

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}/core/auth/google/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: attempt.state,
        codeChallenge: codeChallenge(attempt.verifier),
        nonce: attempt.nonce,
      }),
    });
  } catch {
    return NextResponse.redirect(new URL('/login?error=unreachable', appUrl()));
  }

  if (!upstream.ok) {
    return NextResponse.redirect(new URL('/login?error=google_unavailable', appUrl()));
  }

  const { url } = (await upstream.json()) as { url: string };

  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_STATE_COOKIE, encodeAttempt(attempt), {
    ...cookieOptions,
    // `lax`, not `strict`: Google returns the browser here via a cross-site redirect, and a
    // strict cookie would not be sent, breaking every sign-in.
    sameSite: 'lax',
    maxAge: OAUTH_STATE_MAX_AGE,
    path: '/',
  });

  return res;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}
