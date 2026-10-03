import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { env } from '../../config/env';
import { badRequest, unauthorized } from '../errors';

/**
 * Google as a way of proving identity — nothing more.
 *
 * This module answers one question: "which verified Google account is at the other end of
 * this authorization code?" Deciding whether that account may sign in, and as whom, is
 * `resolveGoogleIdentity` below, kept separate because it is a policy decision with a real
 * security boundary and belongs under test without a network.
 */
export interface GoogleProfile {
  /** Google's stable id for the account. Survives an email change; the email does not. */
  subject: string;
  email: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
  picture?: string;
}

/** Whether Google sign-in is configured at all. */
export function googleEnabled(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

let client: OAuth2Client | null = null;

/**
 * One client, reused.
 *
 * It caches Google's signing keys in process, so verifying an ID token stays local after
 * the first call rather than fetching JWKS on every sign-in.
 */
function oauthClient(): OAuth2Client {
  if (!googleEnabled()) {
    throw badRequest('Google sign-in is not configured on this server.');
  }
  client ??= new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  });
  return client;
}

/**
 * Exchange an authorization code for a verified profile.
 *
 * The `nonce` is the one the web app put in the authorization URL and kept in its state
 * cookie. Checking it here ties this ID token to this browser's sign-in attempt, so a token
 * captured from another flow cannot be replayed into ours.
 */
export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  nonce: string,
): Promise<GoogleProfile> {
  const auth = oauthClient();

  let idToken: string | undefined;
  try {
    const { tokens } = await auth.getToken({ code, codeVerifier });
    idToken = tokens.id_token ?? undefined;
  } catch {
    // A code is single-use and short-lived: a failure here is a replayed or stale code far
    // more often than a broken server, so it is not surfaced as one.
    throw unauthorized('That Google sign-in could not be completed. Please try again.');
  }

  if (!idToken) throw unauthorized('Google did not return an identity token.');

  let payload: TokenPayload | undefined;
  try {
    // Verifies the signature, `iss`, `aud` and `exp`. Audience is pinned to our client id,
    // so a token minted for a different application is rejected.
    const ticket = await auth.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID! });
    payload = ticket.getPayload();
  } catch {
    throw unauthorized('That Google sign-in could not be verified. Please try again.');
  }

  if (!payload?.sub || !payload.email) {
    throw unauthorized('Google did not return an email address for that account.');
  }
  if (payload.nonce !== nonce) {
    throw unauthorized('That Google sign-in could not be verified. Please try again.');
  }

  return {
    subject: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    firstName: payload.given_name,
    lastName: payload.family_name,
    picture: payload.picture,
  };
}

/** Build the URL the browser is sent to, with PKCE and a nonce. */
export function googleAuthUrl(state: string, codeChallenge: string, nonce: string): string {
  return oauthClient().generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    state,
    code_challenge_method: 'S256' as never,
    code_challenge: codeChallenge,
    // Google folds unknown params into the ID token's claims, which is how the nonce
    // reaches `exchangeGoogleCode` for the replay check above.
    nonce,
    // No refresh token is wanted: Google proves identity once and the CRM's own tokens
    // carry the session from there. Asking for offline access would store a credential
    // that nothing uses.
    access_type: 'online',
    prompt: 'select_account',
  } as never);
}
