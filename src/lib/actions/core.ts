'use server';

import { revalidatePath } from 'next/cache';
import type { Account, ModuleKey, Role } from '@/shared';
import { apiSend } from '@/lib/api/server';
import { refreshContext } from '@/lib/api/context';
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
 * Server actions for the core module.
 *
 * Mutations run here rather than in the browser so the access token stays in an httpOnly
 * cookie. Each one revalidates the paths whose rendered output it invalidates — module
 * changes in particular must refresh the layout, since the sidebar is built from them.
 */

// ── CORE-08 · Module toggles ────────────────────────────────────────────────

export async function saveModules(
  accountId: string,
  enabledModules: ModuleKey[],
): Promise<ActionResult<Account>> {
  return action(async () => {
    const account = await apiSend<Account>(`/core/accounts/${accountId}/modules`, {
      method: 'PUT',
      accountId,
      body: { enabledModules },
    });

    // The sidebar lives in the layout, so the whole subtree has to re-render for a
    // disabled module's nav entries to disappear. The agency console renders the same
    // state from its own tree, so it is revalidated too — this action is reachable from
    // both the sub-account settings screen and the agency console.
    revalidatePath(`/app/${accountId}`, 'layout');
    revalidatePath('/agency', 'layout');
    return account;
  });
}

// ── CORE-07 · General settings ──────────────────────────────────────────────

export async function updateAccount(
  accountId: string,
  input: { name?: string; timezone?: string; status?: string; markets?: string[] },
): Promise<ActionResult<Account>> {
  return action(async () => {
    const account = await apiSend<Account>(`/core/accounts/${accountId}`, {
      method: 'PATCH',
      accountId,
      body: input,
    });

    revalidatePath(`/app/${accountId}`, 'layout');
    revalidatePath('/agency', 'layout');
    return account;
  });
}

// ── CORE-06 · Create sub-account ────────────────────────────────────────────

export async function createAccount(
  currentAccountId: string,
  input: { name: string; slug: string; timezone: string; markets: string[]; enabledModules: ModuleKey[] },
): Promise<ActionResult<Account>> {
  return action(async () => {
    // Creating is an agency-level act, but the API resolves tenant context from a
    // sub-account header, so the caller's current account identifies the agency.
    const account = await apiSend<Account>('/core/accounts', {
      method: 'POST',
      accountId: currentAccountId,
      body: input,
    });

    revalidatePath('/agency', 'layout');
    return account;
  });
}

// ── CORE-09 · Invite a user ─────────────────────────────────────────────────

export async function inviteUser(
  accountId: string,
  input: { email: string; firstName: string; lastName: string; roleId: string },
): Promise<ActionResult<InviteResult>> {
  return action(async () => {
    const user = await apiSend<InviteResult>(
      '/core/users/invite',
      { method: 'POST', accountId, body: input },
    );

    revalidatePath(`/app/${accountId}/settings/team`);
    return user;
  });
}

// ── CORE-10 · Custom roles ──────────────────────────────────────────────────

export interface RoleInput {
  name: string;
  description: string;
  permissions: string[];
}

/**
 * Create a custom role, or edit one.
 *
 * A role belongs to the agency and applies in every sub-account that uses it, so both the
 * sub-account's own roles screen and the agency console are revalidated.
 */
export async function saveRole(
  accountId: string,
  /** Omit to create. */
  roleId: string | undefined,
  input: RoleInput,
): Promise<ActionResult<Role>> {
  return action(async () => {
    const role = await apiSend<Role>(roleId ? `/core/roles/${roleId}` : '/core/roles', {
      method: roleId ? 'PATCH' : 'POST',
      accountId,
      // Scope is fixed at creation; this screen manages sub-account roles.
      body: roleId ? input : { ...input, scope: 'account' },
    });

    // Permissions are settled in the context token; reissue so the editor's own change is
    // not hidden from them until the next scheduled reissue.
    await refreshContext();
    revalidatePath(`/app/${accountId}/settings`, 'layout');
    revalidatePath('/agency', 'layout');
    return role;
  });
}

export async function deleteRole(accountId: string, roleId: string): Promise<ActionResult<void>> {
  return action(async () => {
    await apiSend<void>(`/core/roles/${roleId}`, { method: 'DELETE', accountId });
    revalidatePath(`/app/${accountId}/settings`, 'layout');
    revalidatePath('/agency', 'layout');
  });
}

// ── CORE-12 · Custom fields ─────────────────────────────────────────────────

export interface CustomFieldInput {
  entity: 'contact' | 'opportunity';
  label: string;
  type: string;
  options?: string[];
  required: boolean;
}

export async function createField(
  accountId: string,
  input: CustomFieldInput,
): Promise<ActionResult<{ id: string; key: string; label: string }>> {
  return action(async () => {
    const field = await apiSend<{ id: string; key: string; label: string }>('/contacts/fields', {
      method: 'POST',
      accountId,
      body: input,
    });

    revalidatePath(`/app/${accountId}/settings/fields`);
    return field;
  });
}

export async function deleteField(
  accountId: string,
  fieldId: string,
): Promise<ActionResult<void>> {
  return action(async () => {
    await apiSend<void>(`/contacts/fields/${fieldId}`, { method: 'DELETE', accountId });
    revalidatePath(`/app/${accountId}/settings/fields`);
  });
}
