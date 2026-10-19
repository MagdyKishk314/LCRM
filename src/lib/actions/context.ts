'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { issueContext } from '@/lib/api/context';
import { CONTEXT_COOKIE } from '@/lib/api/cookies';

/**
 * Record which context the user chose, then take them there.
 *
 * Entering asks the API for a context token (see `lib/api/context`), which is where the
 * seat is resolved and checked. The choice is kept in the token as a hint, and only ever
 * *narrows* what the session resolves to — the API ignores a context the user does not
 * actually hold.
 */
export async function enterContext(type: 'agency' | 'account', id: string | null) {
  if (type === 'account' && id) {
    await issueContext({ type: 'account', accountId: id, hint: `account:${id}` });
  } else {
    await issueContext({ type: 'agency', hint: 'agency' });
  }

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
