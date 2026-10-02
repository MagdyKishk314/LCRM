import mongoose from 'mongoose';
import { z } from 'zod';
import { ACTIVITY_TYPES, type ActivityType, type HistoryEntry, type HistoryPage } from '@landcaller/shared';
import { badRequest } from '../../core/errors';
import { Activity, EmailMessage, User } from '../../models';

/**
 * The contact history contract (CNT-13).
 *
 * Every record of contact with a person — a note, a call, an email, an appointment, a
 * change to the record — is an `Activity` written through `recordActivity`, read back
 * through `historyFor`. Other modules write here and nowhere else: telephony will record
 * `call` and `sms`, email records `email`, and the contacts module renders them all from
 * one list, one endpoint, one set of tabs.
 *
 * What each type carries in `metadata` is pinned by the schemas below, so a tab can rely
 * on its shape: a call always has a direction and may have a duration and an outcome; an
 * email always names its message.
 */

const DIRECTION = z.enum(['inbound', 'outbound']);

export const ACTIVITY_METADATA: Record<ActivityType, z.ZodTypeAny> = {
  note: z.object({}).passthrough(),
  call: z
    .object({
      direction: DIRECTION.default('outbound'),
      durationSeconds: z.number().int().nonnegative().optional(),
      outcome: z
        .enum(['connected', 'voicemail', 'no_answer', 'busy', 'wrong_number', 'callback'])
        .optional(),
      recordingUrl: z.string().url().optional(),
      phone: z.string().optional(),
    })
    .passthrough(),
  sms: z
    .object({ direction: DIRECTION, phone: z.string().optional(), messageId: z.string().optional() })
    .passthrough(),
  email: z
    .object({ messageId: z.string(), direction: DIRECTION.default('outbound') })
    .passthrough(),
  appointment: z
    .object({
      appointmentId: z.string(),
      startsAt: z.string(),
      outcome: z.string().optional(),
      change: z.enum(['scheduled', 'updated', 'outcome']).default('scheduled'),
    })
    .passthrough(),
  task: z
    .object({ taskId: z.string(), change: z.enum(['created', 'completed', 'reopened']) })
    .passthrough(),
  status_change: z.object({ from: z.string().optional(), to: z.string() }).passthrough(),
  stage_change: z.object({ from: z.string().optional(), to: z.string() }).passthrough(),
  field_change: z
    .object({
      changes: z.array(z.object({ field: z.string(), from: z.unknown().optional(), to: z.unknown().optional() })),
    })
    .passthrough(),
  list_change: z
    .object({ listId: z.string(), listName: z.string().optional(), change: z.enum(['added', 'removed']) })
    .passthrough(),
  import: z.object({ importJobId: z.string(), change: z.enum(['created', 'updated']) }).passthrough(),
  merge: z
    .object({ mergedId: z.string(), mergedName: z.string().optional(), fieldsTaken: z.array(z.string()).optional() })
    .passthrough(),
  created: z.object({}).passthrough(),
};

export interface RecordActivityInput {
  type: ActivityType;
  contactId: string;
  opportunityId?: string;
  /** Who did it. Omit for system-generated entries. */
  userId?: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  channelRef?: { kind: 'email' | 'call' | 'sms' | 'appointment' | 'task' | 'opportunity' | 'import'; id: string };
  occurredAt?: Date;
  pinned?: boolean;
}

/**
 * Write one history entry. Validates the metadata for its type; a malformed entry is a
 * bug in the caller and is refused rather than stored in a shape the tabs cannot read.
 */
export async function recordActivity(input: RecordActivityInput, session?: mongoose.ClientSession) {
  if (!(ACTIVITY_TYPES as readonly string[]).includes(input.type)) {
    throw badRequest(`Unknown history type: ${input.type}`);
  }
  const metadata = ACTIVITY_METADATA[input.type].safeParse(input.metadata ?? {});
  if (!metadata.success) {
    throw badRequest(`History entry of type ${input.type} is malformed`, metadata.error.issues);
  }

  const [doc] = await Activity.create(
    [
      {
        type: input.type,
        contactId: input.contactId,
        opportunityId: input.opportunityId,
        userId: input.userId,
        title: input.title,
        body: input.body,
        metadata: metadata.data,
        channelRef: input.channelRef,
        pinned: input.pinned ?? false,
        occurredAt: input.occurredAt ?? new Date(),
      },
    ],
    session ? { session } : {},
  );
  return doc!;
}

export interface HistoryQuery {
  type?: ActivityType;
  /** An entry id; returns entries older than it. */
  before?: string;
  limit?: number;
}

/**
 * A page of a contact's history, newest first, with the actor resolved and — for email
 * entries — the message's current state, so the Emails tab can show "opened" without a
 * second request.
 *
 * Cursor-paginated on `(occurredAt, _id)`: an offset would skip or repeat rows when a new
 * entry lands between pages, which on a contact being worked is constant.
 */
export async function historyFor(contactId: string, query: HistoryQuery = {}): Promise<HistoryPage> {
  const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
  const filter: Record<string, unknown> = { contactId };
  if (query.type) filter.type = query.type;

  if (query.before) {
    const cursor = await Activity.findById(query.before).select('occurredAt');
    if (cursor) {
      filter.$or = [
        { occurredAt: { $lt: cursor.occurredAt } },
        { occurredAt: cursor.occurredAt, _id: { $lt: cursor._id } },
      ];
    }
  }

  const rows = await Activity.find(filter)
    .sort({ occurredAt: -1, _id: -1 })
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? String(page[page.length - 1]!._id) : null;

  const userIds = [...new Set(page.map((a) => a.userId).filter((id): id is string => Boolean(id)))];
  const emailIds = page
    .filter((a) => a.type === 'email')
    .map((a) => a.channelRef?.id ?? (a.metadata as { messageId?: string } | undefined)?.messageId)
    .filter((id): id is string => Boolean(id));

  const [users, emails] = await Promise.all([
    userIds.length > 0 ? User.find({ _id: { $in: userIds } }).select('firstName lastName').lean() : [],
    emailIds.length > 0
      ? EmailMessage.find({ _id: { $in: emailIds } })
          .select('subject direction status to sentAt openedAt')
          .lean()
      : [],
  ]);
  const userById = new Map(users.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
  const emailById = new Map(emails.map((e) => [String(e._id), e]));

  const data = page.map((a): HistoryEntry => {
    const json = a.toJSON() as unknown as HistoryEntry;
    const emailId = a.channelRef?.id ?? (a.metadata as { messageId?: string } | undefined)?.messageId;
    const email = a.type === 'email' && emailId ? emailById.get(emailId) : undefined;
    return {
      ...json,
      actor: a.userId && userById.has(a.userId) ? { id: a.userId, name: userById.get(a.userId)! } : null,
      email: email
        ? {
            id: String(email._id),
            subject: email.subject,
            direction: email.direction as 'inbound' | 'outbound',
            status: email.status as HistoryEntry['email'] extends infer E ? (E extends { status: infer S } ? S : never) : never,
            to: email.to,
            sentAt: email.sentAt?.toISOString(),
            openedAt: email.openedAt?.toISOString(),
          }
        : a.type === 'email'
          ? null
          : undefined,
    };
  });

  return { data, nextCursor };
}

/** How many entries of each type a contact has — the tab badges. */
export async function historyCounts(contactId: string): Promise<Partial<Record<ActivityType, number>>> {
  const rows: { _id: ActivityType; n: number }[] = await Activity.aggregate([
    { $match: { contactId } },
    { $group: { _id: '$type', n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}
