import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The per-attempt secrets an OAuth round trip needs, carried in a cookie.
 *
 * Three values have to survive the browser's trip to Google and back: `state` (proves the
 * callback belongs to a sign-in this browser started), the PKCE `verifier` (proves the code
 * is being redeemed by whoever asked for it), and `nonce` (ties the returned ID token to
 * this attempt).
 *
 * They live in one short-lived httpOnly cookie rather than a store, and that is the whole
 * scalability argument for this design: an in-memory map breaks the moment there are two
 * instances, and a database row costs a write and a read on every *attempted* sign-in —
 * including the ones people abandon at Google's screen. A cookie costs nothing and works
 * across any number of instances with no shared state at all.
 */
export const OAUTH_STATE_COOKIE = 'lc_oauth';

/** Long enough to choose an account and type a password, short enough to be forgettable. */
export const OAUTH_STATE_MAX_AGE = 10 * 60;

export interface OAuthAttempt {
  state: string;
  verifier: string;
  nonce: string;
}

/** Fresh, unguessable values for one sign-in attempt. */
export function createAttempt(): OAuthAttempt {
  return {
    state: randomBytes(32).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
    nonce: randomBytes(16).toString('base64url'),
  };
}

/** The S256 challenge Google is given, derived from the verifier we keep. */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function encodeAttempt(attempt: OAuthAttempt): string {
  return Buffer.from(JSON.stringify(attempt), 'utf8').toString('base64url');
}

export function decodeAttempt(raw: string | undefined): OAuthAttempt | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as OAuthAttempt;
    if (!parsed.state || !parsed.verifier || !parsed.nonce) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Compare the returned `state` against the stored one without leaking timing.
 *
 * The cookie is httpOnly and the value is random, so this is belt and braces — but a
 * comparison on a security token is not the place to save three lines.
 */
export function stateMatches(expected: string, received: string | null): boolean {
  if (!received) return false;

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
