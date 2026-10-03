'use server';

import { revalidatePath } from 'next/cache';
import { apiSend } from '@/lib/api/server';
import { action, type ActionResult } from '@/lib/api/errors';

/**
 * What an invite returns.
 *
 * `inviteUrl` is present only when a fresh invite was issued, and only this once — it is
 * how the new user sets a password while email is not configured.
 */
export interface InviteResult {
  id: string;
  email: string;
  role: string;
  scope?: string;
  inviteUrl: string | null;
  inviteExpiresAt: string | null;
}

/**
 * Agency console mutations.
 *
 * Anything that targets one sub-account reuses the existing per-account endpoint with
 * `accountId` set — an agency user is already a member of every account beneath them, so
 * no parallel API is needed. Only genuinely cross-account operations call `/core/agency/*`.
 */

// ── AGY-12 · Agency record ──────────────────────────────────────────────────

export async function updateAgency(input: {
  name?: string;
  branding?: { logoUrl?: string; primaryColor?: string; customDomain?: string };
}): Promise<ActionResult<Record<string, unknown>>> {
  return action(async () => {
    const agency = await apiSend<Record<string, unknown>>('/core/agency', {
      method: 'PATCH',
      body: input,
    });
    revalidatePath('/agency', 'layout');
    return agency;
  });
}

// ── AGY-10 · People ─────────────────────────────────────────────────────────

export async function inviteAgencyUser(input: {
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  /** Omit for an agency-wide seat covering every sub-account. */
  accountId?: string;
}): Promise<ActionResult<InviteResult>> {
  return action(async () => {
    const user = await apiSend<InviteResult>(
      '/core/agency/users/invite',
      { method: 'POST', body: input },
    );
    revalidatePath('/agency/people');
    if (input.accountId) revalidatePath(`/agency/accounts/${input.accountId}/team`);
    return user;
  });
}

export async function updateMembership(
  membershipId: string,
  input: { roleId?: string; status?: 'active' | 'suspended' },
): Promise<ActionResult<Record<string, unknown>>> {
  return action(async () => {
    const membership = await apiSend<Record<string, unknown>>(
      `/core/agency/memberships/${membershipId}`,
      { method: 'PATCH', body: input },
    );
    revalidatePath('/agency/people');
    return membership;
  });
}

export async function revokeMembership(
  membershipId: string,
  /** Only used to revalidate that sub-account's team tab. */
  accountId?: string,
): Promise<ActionResult<void>> {
  return action(async () => {
    await apiSend<void>(`/core/agency/memberships/${membershipId}`, { method: 'DELETE' });
    revalidatePath('/agency/people');
    if (accountId) revalidatePath(`/agency/accounts/${accountId}/team`);
  });
}

// Acting on a single sub-account deliberately has no action here: the shared
// SettingsForm and ModuleToggles call `updateAccount` and `saveModules` from
// ./core, which now revalidate both the sub-account tree and the agency console.
// A parallel pair would be a second thing to keep in step for no gain.
