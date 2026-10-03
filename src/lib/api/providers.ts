import { apiFetch } from './client';

/**
 * Which sign-in providers are configured.
 *
 * Deliberately does **not** go through `apiGet`. That helper is for pages inside the shell:
 * it requires an access token and redirects to `/login` when there is none. The sign-in and
 * invite screens are the two places where having no token is normal, so calling it there
 * makes `/login` redirect to `/login` — an infinite loop that renders as a hanging page.
 *
 * Never throws. A provider probe is decoration: if the API is unreachable, the password form
 * must still render. Failing here would take down the only page a locked-out user can reach.
 */
export interface Providers {
  google: boolean;
}

const NONE: Providers = { google: false };

export async function fetchProviders(): Promise<Providers> {
  try {
    return await apiFetch<Providers>('/core/auth/providers');
  } catch {
    return NONE;
  }
}
