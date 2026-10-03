'use server';

import { revalidatePath } from 'next/cache';
import type {
  Activity,
  Contact,
  ContactFilter,
  ContactList,
  HistoryPage,
  ImportJob,
  PropertyInfo,
} from '@/shared';
import { apiGet, apiSend } from '@/lib/api/server';
import { action, type ActionResult } from '@/lib/api/errors';

/** Server actions for the contacts module. */

const contactPath = (accountId: string, contactId: string) => `/app/${accountId}/contacts/${contactId}`;

// ── Create and edit ─────────────────────────────────────────────────────────

export interface ContactInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  altPhones?: string[];
  company?: string;
  status?: string;
  source?: string;
  /** `null` clears the owner. */
  ownerId?: string | null;
  tags?: string[];
  address?: { street?: string; city?: string; state?: string; postalCode?: string };
  /** The full set of parcels; one marked `isPrimary`. */
  properties?: PropertyInfo[];
  /** The legacy single parcel; still accepted, edits the primary. */
  property?: PropertyInfo;
  customFields?: Record<string, unknown>;
  dnc?: boolean;
}

export async function createContact(accountId: string, input: ContactInput): Promise<ActionResult<Contact>> {
  return action(async () => {
    const contact = await apiSend<Contact>('/contacts', { method: 'POST', accountId, body: input });
    revalidatePath(`/app/${accountId}/contacts`);
    return contact;
  });
}

export async function updateContact(
  accountId: string,
  contactId: string,
  input: Partial<ContactInput>,
): Promise<ActionResult<Contact>> {
  return action(async () => {
    const contact = await apiSend<Contact>(`/contacts/${contactId}`, { method: 'PATCH', accountId, body: input });
    revalidatePath(contactPath(accountId, contactId));
    revalidatePath(`/app/${accountId}/contacts`);
    return contact;
  });
}

export async function deleteContact(accountId: string, contactId: string): Promise<ActionResult<void>> {
  return action(async () => {
    await apiSend<void>(`/contacts/${contactId}`, { method: 'DELETE', accountId });
    revalidatePath(`/app/${accountId}/contacts`);
  });
}

/** Contacts that already hold this phone or email — asked before a save, never blocking it. */
export async function checkDuplicates(
  accountId: string,
  input: { phone?: string; email?: string; exclude?: string },
): Promise<ActionResult<Pick<Contact, 'id' | 'firstName' | 'lastName' | 'email' | 'phone' | 'status'>[]>> {
  return action(async () => {
    const query = new URLSearchParams();
    if (input.phone) query.set('phone', input.phone);
    if (input.email) query.set('email', input.email);
    if (input.exclude) query.set('exclude', input.exclude);
    const res = await apiGet<{ data: Pick<Contact, 'id' | 'firstName' | 'lastName' | 'email' | 'phone' | 'status'>[] }>(
      `/contacts/duplicates?${query}`,
      { accountId },
    );
    return res.data;
  });
}

/** A few contacts matching a typed name or number — for pickers such as the merge dialog. */
export async function searchContacts(
  accountId: string,
  search: string,
): Promise<ActionResult<Pick<Contact, 'id' | 'firstName' | 'lastName' | 'email' | 'phone' | 'status' | 'property'>[]>> {
  return action(async () => {
    const res = await apiGet<{ data: Contact[] }>(`/contacts?search=${encodeURIComponent(search)}&pageSize=8`, { accountId });
    return res.data;
  });
}

export type MergeField = 'firstName' | 'lastName' | 'email' | 'phone' | 'company' | 'source' | 'ownerId' | 'address' | 'customFields';

export async function mergeContacts(
  accountId: string,
  survivorId: string,
  duplicateId: string,
  take: MergeField[],
): Promise<ActionResult<Contact>> {
  return action(async () => {
    const contact = await apiSend<Contact>(`/contacts/${survivorId}/merge`, {
      method: 'POST',
      accountId,
      body: { duplicateId, take },
    });
    revalidatePath(contactPath(accountId, survivorId));
    revalidatePath(`/app/${accountId}/contacts`);
    return contact;
  });
}

// ── History ─────────────────────────────────────────────────────────────────

export async function loadHistory(
  accountId: string,
  contactId: string,
  query: { type?: string; before?: string; limit?: number } = {},
): Promise<ActionResult<HistoryPage>> {
  return action(() => {
    const params = new URLSearchParams();
    if (query.type) params.set('type', query.type);
    if (query.before) params.set('before', query.before);
    if (query.limit) params.set('limit', String(query.limit));
    return apiGet<HistoryPage>(`/contacts/${contactId}/history?${params}`, { accountId });
  });
}

export async function logActivity(
  accountId: string,
  contactId: string,
  input: {
    type: 'note' | 'call' | 'sms';
    title?: string;
    body?: string;
    metadata?: Record<string, unknown>;
    occurredAt?: string;
    pinned?: boolean;
  },
): Promise<ActionResult<Activity>> {
  return action(async () => {
    const activity = await apiSend<Activity>(`/contacts/${contactId}/activities`, {
      method: 'POST',
      accountId,
      body: input,
    });
    revalidatePath(contactPath(accountId, contactId));
    return activity;
  });
}

export async function updateNote(
  accountId: string,
  contactId: string,
  activityId: string,
  input: { pinned?: boolean; body?: string },
): Promise<ActionResult<Activity>> {
  return action(async () => {
    const activity = await apiSend<Activity>(`/contacts/${contactId}/activities/${activityId}`, {
      method: 'PATCH',
      accountId,
      body: input,
    });
    revalidatePath(contactPath(accountId, contactId));
    return activity;
  });
}

export async function deleteNote(accountId: string, contactId: string, activityId: string): Promise<ActionResult<void>> {
  return action(async () => {
    await apiSend<void>(`/contacts/${contactId}/activities/${activityId}`, { method: 'DELETE', accountId });
    revalidatePath(contactPath(accountId, contactId));
  });
}

// ── Lists on the record ─────────────────────────────────────────────────────

export async function setContactListMembership(
  accountId: string,
  contactId: string,
  listId: string,
  member: boolean,
): Promise<ActionResult<void>> {
  return action(async () => {
    await apiSend<void>(`/contacts/${contactId}/lists/${listId}`, { method: member ? 'POST' : 'DELETE', accountId });
    revalidatePath(contactPath(accountId, contactId));
  });
}

// ── Bulk ────────────────────────────────────────────────────────────────────

export type BulkAction =
  | 'tag'
  | 'untag'
  | 'status'
  | 'dnc'
  | 'addToList'
  | 'removeFromList'
  | 'assignOwner'
  | 'setSource'
  | 'delete';

export async function bulkUpdate(
  accountId: string,
  input: {
    action: BulkAction;
    value?: string;
    ids?: string[];
    /** Act on the whole filter result instead of a selection. */
    filter?: ContactFilter | Record<string, string | undefined>;
    /** Required by the API for a filter-based delete; rejected if it no longer matches. */
    expectedCount?: number;
  },
): Promise<ActionResult<{ action: string; affected: number }>> {
  return action(async () => {
    const result = await apiSend<{ action: string; affected: number }>('/contacts/bulk', {
      method: 'POST',
      accountId,
      body: input,
    });
    revalidatePath(`/app/${accountId}/contacts`);
    return result;
  });
}

// ── Lists ───────────────────────────────────────────────────────────────────

export async function createList(
  accountId: string,
  input: { name: string; description?: string; type: 'static' | 'smart'; filter?: ContactFilter; memberIds?: string[] },
): Promise<ActionResult<ContactList>> {
  return action(async () => {
    const list = await apiSend<ContactList>('/contacts/lists', { method: 'POST', accountId, body: input });
    revalidatePath(`/app/${accountId}/contacts`, 'layout');
    return list;
  });
}

export async function updateList(
  accountId: string,
  listId: string,
  input: { name?: string; description?: string; filter?: ContactFilter },
): Promise<ActionResult<ContactList>> {
  return action(async () => {
    const list = await apiSend<ContactList>(`/contacts/lists/${listId}`, { method: 'PATCH', accountId, body: input });
    revalidatePath(`/app/${accountId}/contacts`, 'layout');
    return list;
  });
}

export async function duplicateList(accountId: string, listId: string): Promise<ActionResult<ContactList>> {
  return action(async () => {
    const list = await apiSend<ContactList>(`/contacts/lists/${listId}/duplicate`, { method: 'POST', accountId });
    revalidatePath(`/app/${accountId}/contacts/lists`);
    return list;
  });
}

export async function deleteList(accountId: string, listId: string): Promise<ActionResult<void>> {
  return action(async () => {
    await apiSend<void>(`/contacts/lists/${listId}`, { method: 'DELETE', accountId });
    revalidatePath(`/app/${accountId}/contacts`, 'layout');
  });
}

// ── Import ──────────────────────────────────────────────────────────────────

/**
 * What one chunk of an import reported.
 *
 * The wizard sums these as it goes, so the totals it shows are the totals actually written
 * rather than an estimate — and a chunk that fails leaves the earlier ones applied, which is
 * safe because the import matches on its keys and re-running only updates.
 */
export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
  errorCount: number;
  total: number;
}

export interface ImportChunk {
  columns: string[];
  rows: string[][];
  mapping: Record<string, string>;
  jobId: string;
  /** Where this chunk starts in the file, so row numbers match the spreadsheet. */
  offset: number;
}

export async function startImportJob(
  accountId: string,
  input: {
    fileName: string;
    tag?: string;
    listId?: string;
    ownerId?: string;
    strategy: 'update' | 'skip' | 'create';
    mapping: Record<string, string>;
    totalRows: number;
  },
): Promise<ActionResult<ImportJob>> {
  return action(() => apiSend<ImportJob>('/contacts/import/jobs', { method: 'POST', accountId, body: input }));
}

/** How many of a chunk's rows would match an existing contact. */
export async function previewImportChunk(
  accountId: string,
  input: { columns: string[]; rows: string[][]; mapping: Record<string, string> },
): Promise<ActionResult<{ rows: number; nameless: number; matched: number; unmatched: number }>> {
  return action(() =>
    apiSend<{ rows: number; nameless: number; matched: number; unmatched: number }>('/contacts/import/preview', {
      method: 'POST',
      accountId,
      body: input,
    }),
  );
}

/**
 * Send one slice of a file.
 *
 * Deliberately one chunk per call rather than a whole file: every request stays small and
 * short, which is what lets a 50 MB import run on a platform that caps request bodies and
 * function duration. The browser parses the file and drives the loop.
 */
export async function commitImportChunk(accountId: string, input: ImportChunk): Promise<ActionResult<ImportResult>> {
  return action(() => apiSend<ImportResult>('/contacts/import/commit', { method: 'POST', accountId, body: input }));
}

export async function finishImportJob(
  accountId: string,
  jobId: string,
  status: 'finished' | 'failed',
): Promise<ActionResult<ImportJob>> {
  return action(async () => {
    const job = await apiSend<ImportJob>(`/contacts/import/jobs/${jobId}/finish`, { method: 'POST', accountId, body: { status } });
    // One revalidation at the end rather than one per chunk.
    revalidatePath(`/app/${accountId}/contacts`, 'layout');
    return job;
  });
}

export async function undoImport(accountId: string, jobId: string): Promise<ActionResult<{ deleted: number; kept: number }>> {
  return action(async () => {
    const result = await apiSend<{ deleted: number; kept: number }>(`/contacts/import/jobs/${jobId}/undo`, {
      method: 'POST',
      accountId,
    });
    revalidatePath(`/app/${accountId}`, 'layout');
    return result;
  });
}
