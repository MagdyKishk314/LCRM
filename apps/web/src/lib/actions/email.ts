'use server';

import { revalidatePath } from 'next/cache';
import type { EmailIdentity, EmailMessage, EmailTemplate } from '@landcaller/shared';
import { apiSend } from '@/lib/api/server';
import { action, type ActionResult } from '@/lib/api/errors';

/** Server actions for the email module. */

// ── Messages ────────────────────────────────────────────────────────────────

export interface SendEmailInput {
  to: string[];
  cc?: string[];
  /** Optional when a template supplies them. */
  subject?: string;
  body?: string;
  templateId?: string;
  identityId?: string;
  /** Merge fields resolve against this contact, and the message lands on their timeline. */
  contactId?: string;
}

export async function sendEmail(
  accountId: string,
  input: SendEmailInput,
): Promise<ActionResult<EmailMessage>> {
  return action(async () => {
    const message = await apiSend<EmailMessage>('/email/messages', {
      method: 'POST',
      accountId,
      body: input,
    });
    revalidatePath(`/app/${accountId}/email`);
    if (input.contactId) revalidatePath(`/app/${accountId}/contacts/${input.contactId}`);
    return message;
  });
}

// ── Templates ───────────────────────────────────────────────────────────────

export interface TemplateInput {
  name: string;
  subject: string;
  body: string;
  category?: string;
}

export async function saveTemplate(
  accountId: string,
  /** Omit to create. */
  templateId: string | undefined,
  input: TemplateInput,
): Promise<ActionResult<EmailTemplate>> {
  return action(async () => {
    const template = await apiSend<EmailTemplate>(
      templateId ? `/email/templates/${templateId}` : '/email/templates',
      { method: templateId ? 'PATCH' : 'POST', accountId, body: input },
    );
    revalidatePath(`/app/${accountId}/email`, 'layout');
    return template;
  });
}

export async function deleteTemplate(
  accountId: string,
  templateId: string,
): Promise<ActionResult<void>> {
  return action(async () => {
    await apiSend<void>(`/email/templates/${templateId}`, { method: 'DELETE', accountId });
    revalidatePath(`/app/${accountId}/email`, 'layout');
  });
}

// ── Sending addresses ───────────────────────────────────────────────────────

/**
 * An identity as the API returns it after creating or re-sending.
 *
 * `verifyUrl` is present only while SMTP is not configured, which is the one case where the
 * confirmation mail cannot reach the address — so the link is shown to the admin to pass on,
 * exactly as an invite link is.
 */
export type IdentityResult = EmailIdentity & { verifyUrl: string | null };

export async function createIdentity(
  accountId: string,
  input: { fromName: string; fromEmail: string; replyTo?: string; isDefault?: boolean },
): Promise<ActionResult<IdentityResult>> {
  return action(async () => {
    const identity = await apiSend<IdentityResult>('/email/identities', {
      method: 'POST',
      accountId,
      body: input,
    });
    revalidatePath(`/app/${accountId}/email`);
    return identity;
  });
}

export async function resendIdentityVerification(
  accountId: string,
  identityId: string,
): Promise<ActionResult<IdentityResult>> {
  return action(() =>
    apiSend<IdentityResult>(`/email/identities/${identityId}/resend`, {
      method: 'POST',
      accountId,
    }),
  );
}

export async function makeDefaultIdentity(
  accountId: string,
  identityId: string,
): Promise<ActionResult<EmailIdentity>> {
  return action(async () => {
    const identity = await apiSend<EmailIdentity>(`/email/identities/${identityId}/default`, {
      method: 'POST',
      accountId,
    });
    revalidatePath(`/app/${accountId}/email`);
    return identity;
  });
}

export async function deleteIdentity(
  accountId: string,
  identityId: string,
): Promise<ActionResult<void>> {
  return action(async () => {
    await apiSend<void>(`/email/identities/${identityId}`, { method: 'DELETE', accountId });
    revalidatePath(`/app/${accountId}/email`);
  });
}
