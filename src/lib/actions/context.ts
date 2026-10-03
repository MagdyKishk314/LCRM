'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CONTEXT_COOKIE, cookieOptions, REFRESH_MAX_AGE } from '@/lib/api/cookies';

/**
 * Record which context the user chose, then take them there.
 *
 * The cookie only ever *narrows* what the session resolves to — the API ignores a context
 * the user does not actually hold — so this is a preference, not a permission.
 */
export async function enterContext(type: 'agency' | 'account', id: string | null) {
  const store = await cookies();

  store.set(CONTEXT_COOKIE, type === 'agency' ? 'agency' : `account:${id ?? ''}`, {
    ...cookieOptions,
    maxAge: REFRESH_MAX_AGE,
  });

  redirect(type === 'agency' ? '/agency' : `/app/${id}`);
}

/**
 * Forget the choice and ask again.
 *
 * Used by "Switch account". Clearing rather than overwriting means the chooser decides,
 * including when the user's memberships have changed since they last picked.
 */
export async function switchContext() {
  const store = await cookies();
  store.delete(CONTEXT_COOKIE);
  redirect('/choose');
}
