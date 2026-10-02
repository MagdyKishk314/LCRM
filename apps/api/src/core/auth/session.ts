import type { Response } from 'express';
import { env } from '../../config/env';
import { signAccessToken, signRefreshToken } from './jwt';

/**
 * Turning "this is who you are" into a session, in one place.
 *
 * Three things prove identity — a password, an invite link, and now a Google account — and
 * they must all end in exactly the same session: the same claims, the same refresh cookie,
 * the same revocation semantics. Proof is where they differ; everything after it is not.
 *
 * Adding Google as a fourth copy of this block would mean a token that differs subtly from
 * the other two, which is the kind of thing nobody notices until a session refuses to
 * refresh months later. See docs/PLAN.md §7.
 */
export const REFRESH_COOKIE = 'lc_refresh';

/** 30 days, matching the refresh token's own lifetime. */
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

/** The minimum an authenticated user has to look like for a session to be issued. */
export interface SessionUser {
  _id: unknown;
  email: string;
  firstName: string;
  lastName: string;
  tokenVersion?: number | null;
}

export interface IssuedSession {
  accessToken: string;
  user: { id: string; email: string; firstName: string; lastName: string };
}

/**
 * Issue an access token, set the refresh cookie, and return the login response body.
 *
 * The refresh cookie is scoped to the auth routes rather than the whole API: it is only
 * ever presented to `/refresh` and `/logout`, so no other endpoint should receive it.
 */
export function issueSession(res: Response, user: SessionUser): IssuedSession {
  const id = String(user._id);

  const accessToken = signAccessToken({ sub: id, email: user.email });
  const refreshToken = signRefreshToken({ sub: id, tv: user.tokenVersion ?? 0 });

  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    path: '/api/v1/core/auth',
    maxAge: REFRESH_MAX_AGE,
  });

  return {
    accessToken,
    user: {
      id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    },
  };
}
