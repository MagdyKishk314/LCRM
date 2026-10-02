'use server';

import { apiFetch } from '@/lib/api/client';
import { action, type ActionResult } from '@/lib/api/errors';

/**
 * Confirm a sending address from its emailed link.
 *
 * Unauthenticated on purpose: whoever opens the link is whoever reads that mailbox, and may
 * not be a CRM user at all. The token is the credential. So this uses `apiFetch` directly —
 * the session-bound helpers would redirect to `/login` and the link would never work for
 * the person it was sent to.
 */
export async function confirmSender(
  token: string,
): Promise<ActionResult<{ fromEmail: string; fromName: string }>> {
  return action(() =>
    apiFetch<{ fromEmail: string; fromName: string }>('/core/sender-verification', {
      method: 'POST',
      body: { token },
    }),
  );
}
