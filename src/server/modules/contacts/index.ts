import { Router } from 'express';
import { z } from 'zod';
import {
  ACTIVITY_TYPES,
  CONTACT_STATUSES,
  hasPermission,
  isEmptyContactFilter,
  isSafeKey,
  parseContactFilter,
  phoneDigits,
  type ActivityType,
} from '@/shared';
import { requirePermission } from '../../core/auth/middleware';
import { badRequest, conflict, forbidden, handler, notFound } from '../../core/errors';
import { paginate, parseSort } from '../../core/pagination';
import type { ApiModule } from '../../core/registry';
import { assertTenantMatch } from '../../core/tenancy/plugin';
import {
  Activity,
  Appointment,
  AuditLog,
  Contact,
  ContactField,
  ContactList,
  Opportunity,
  Task,
} from '../../models';
import { registerAppointmentRoutes } from './appointments.routes';
import { contactFieldDefinitions, validateCustomFields } from './custom-fields';
import { deleteContacts } from './delete';
import { DNC_CLEARED_STATUS, reconcileDnc } from './dnc';
import { SORTABLE_FIELDS, buildContactQuery, contactListQuerySchema, resolveContactQuery, smartListFilterSchema } from './filters';
import { historyCounts, historyFor, recordActivity } from './history';
import { registerImportExportRoutes } from './import-export.routes';
import { memberById, membersOf } from './members';
import { MERGEABLE_FIELDS, mergeContacts } from './merge';
import { registerTaskRoutes } from './tasks.routes';

// Every route below already sits behind authenticate → resolveTenant →
// requireModule('contacts'), applied once by the registry at mount time.
const router = Router();

const addressSchema = z.object({
  street: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  state: z.string().max(40).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(60).optional(),
});

const parcelSchema = z.object({
  id: z.string().optional(),
  isPrimary: z.boolean().optional(),
  apn: z.string().max(80).optional(),
  county: z.string().max(80).optional(),
  state: z.string().max(40).optional(),
  acres: z.number().nonnegative().optional(),
  assessedValue: z.number().nonnegative().optional(),
  legalDescription: z.string().max(2_000).optional(),
});

const safeKeys = (v: Record<string, unknown>) => Object.keys(v).every(isSafeKey);

const contactBodySchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(40).optional(),
  altPhones: z.array(z.string().max(40)).max(10).optional(),
  company: z.string().max(120).optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  source: z.string().max(80).optional(),
  ownerId: z.string().nullable().optional(),
  tags: z.array(z.string().min(1).max(60)).max(100).optional(),
  address: addressSchema.optional(),
  /** The legacy single parcel; accepted and lifted into `properties`. */
  property: parcelSchema.optional(),
  properties: z.array(parcelSchema).max(50).optional(),
  // Keys become Mongo paths (`customFields.<key>`), so a dot or a leading `$` would write
  // somewhere other than where it says.
  customFields: z
    .record(z.unknown())
    .refine(safeKeys, { message: 'Custom field keys cannot contain "." or start with "$"' })
    .optional(),
  dnc: z.boolean().optional(),
});

/** Fields whose edits are written to the history as a `field_change`. */
const TRACKED_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'altPhones',
  'company',
  'source',
  'ownerId',
  'tags',
  'address',
  'properties',
  'customFields',
] as const;

function snapshot(contact: { toJSON(): Record<string, unknown> }): Record<string, unknown> {
  const json = contact.toJSON();
  return Object.fromEntries(TRACKED_FIELDS.map((f) => [f, normalise(json[f])]));
}

/** Strip ids and undefined so two snapshots of the same data compare equal. */
function normalise(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value ?? null, (key, v) => (key === 'id' || key === '_id' ? undefined : v)),
  );
}

function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  return TRACKED_FIELDS.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f])).map((f) => ({
    field: f,
    from: before[f],
    to: after[f],
  }));
}

/** A caller with the permission may assign only someone who can act in this sub-account. */
async function assertOwner(ctx: { agencyId: string; accountId?: string }, ownerId: string | null | undefined) {
  if (!ownerId) return;
  if (!(await memberById(ctx, ownerId))) throw badRequest('That person is not a member of this sub-account');
}

// Registered first: Express matches in declaration order, and `/export` is a single
// segment that the `/:id` route further down would otherwise swallow.
registerImportExportRoutes(router);
registerTaskRoutes(router);
registerAppointmentRoutes(router);

// ── List ────────────────────────────────────────────────────────────────────

router.get(
  '/',
  requirePermission('contacts:contact:read'),
  handler(async (req, res) => {
    const q = contactListQuerySchema.parse(req.query);
    const ctx = req.tenant!;

    // The tenancy plugin adds agencyId/accountId — this only narrows within the tenant.
    const query = await resolveContactQuery(q, ctx);

    const sortField = q.sort?.replace(/^-/, '');
    const sort = sortField && SORTABLE_FIELDS.has(sortField) ? parseSort(q.sort, { createdAt: -1 }) : { createdAt: -1 as const };

    const [data, total] = await Promise.all([
      Contact.find(query)
        .sort({ ...sort, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize),
      Contact.countDocuments(query),
    ]);

    assertTenantMatch(data, 'contacts.list');
    res.json(paginate(data, total, q));
  }),
);

/**
 * Distinct values for the filter controls, from the account's own data, plus the people
 * who can own a contact.
 */
router.get(
  '/facets',
  requirePermission('contacts:contact:read'),
  handler(async (req, res) => {
    const [states, counties, tags, sources, members, fields] = await Promise.all([
      Contact.distinct('properties.state'),
      Contact.distinct('properties.county'),
      Contact.distinct('tags'),
      Contact.distinct('source'),
      membersOf(req.tenant!),
      contactFieldDefinitions(),
    ]);

    const clean = (list: unknown[]) => list.filter((v): v is string => typeof v === 'string' && v !== '').sort();

    res.json({
      states: clean(states),
      counties: clean(counties),
      tags: clean(tags),
      sources: clean(sources),
      owners: members,
      fields,
    });
  }),
);

// ── Duplicates ──────────────────────────────────────────────────────────────

/**
 * Would this phone or email collide with a contact that already exists? Asked by the
 * create and edit forms before saving, so the person is offered the existing record
 * rather than making a second one.
 */
router.get(
  '/duplicates',
  requirePermission('contacts:contact:read'),
  handler(async (req, res) => {
    const q = z
      .object({ phone: z.string().optional(), email: z.string().optional(), exclude: z.string().optional() })
      .parse(req.query);

    const or: Record<string, unknown>[] = [];
    const digits = phoneDigits(q.phone);
    if (digits) or.push({ phoneDigits: digits }, { altPhoneDigits: digits });
    const email = q.email?.trim().toLowerCase();
    if (email) or.push({ email });

    if (or.length === 0) {
      res.json({ data: [] });
      return;
    }

    const matches = await Contact.find({ $or: or, ...(q.exclude ? { _id: { $ne: q.exclude } } : {}) })
      .select('firstName lastName email phone status property')
      .limit(5);

    res.json({ data: matches });
  }),
);

/**
 * Likely duplicate pairs across the sub-account: the same phone digits, or the same email.
 * For the Settings → Duplicates page. Grouped in the database; capped so a list that has
 * never been cleaned does not return thousands of rows at once.
 */
router.get(
  '/duplicates/all',
  requirePermission('contacts:contact:update'),
  handler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);

    const groups = async (field: 'phoneDigits' | 'email') => {
      const rows: { _id: string; ids: string[]; n: number }[] = await Contact.aggregate([
        { $match: { [field]: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: `$${field}`, ids: { $push: '$_id' }, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        { $sort: { n: -1 } },
        { $limit: limit },
      ]);
      return rows.map((r) => ({ by: field, value: r._id, ids: r.ids.map(String) }));
    };

    const found = [...(await groups('phoneDigits')), ...(await groups('email'))].slice(0, limit);
    const ids = [...new Set(found.flatMap((g) => g.ids))];
    const contacts = ids.length
      ? await Contact.find({ _id: { $in: ids } }).select('firstName lastName email phone status property createdAt lastActivityAt')
      : [];
    const byId = new Map(contacts.map((c) => [String(c._id), c]));

    res.json({
      data: found.map((g) => ({
        by: g.by === 'phoneDigits' ? 'phone' : 'email',
        value: g.value,
        contacts: g.ids.map((id) => byId.get(id)).filter(Boolean),
      })),
    });
  }),
);

// ── Create ──────────────────────────────────────────────────────────────────

router.post(
  '/',
  requirePermission('contacts:contact:create'),
  handler(async (req, res) => {
    const input = contactBodySchema.parse(req.body);
    const ctx = req.tenant!;

    await assertOwner(ctx, input.ownerId);
    const defs = await contactFieldDefinitions();
    const customFields = validateCustomFields(defs, input.customFields ?? {}, { partial: false });

    // agencyId/accountId are stamped by the tenancy plugin, never taken from the body.
    const contact = await Contact.create({
      ...input,
      email: input.email || undefined,
      ownerId: input.ownerId ?? undefined,
      customFields,
      // A contact marked do-not-call must carry the flag the dialer checks, and vice
      // versa — letting these disagree is how a scrubbed number gets dialled.
      ...reconcileDnc({ dnc: false, status: 'new' }, input),
      lastActivityAt: new Date(),
    });

    await recordActivity({
      type: 'created',
      contactId: String(contact._id),
      userId: ctx.userId,
      title: 'Contact created',
    });

    res.status(201).json(contact);
  }),
);

// ── Custom fields (CORE-12) ─────────────────────────────────────────────────
// The UI lives under Settings, but the model and the `contacts:field:manage`
// permission belong to this module, so the endpoints do too.
//
// Registered before `/:id`: Express matches in declaration order, and `/fields` is a
// single segment, so the `/:id` route below would otherwise swallow it and 404 looking
// for a contact called "fields".

router.get(
  '/fields',
  requirePermission('contacts:field:manage', 'contacts:contact:read'),
  handler(async (_req, res) => {
    const fields = await ContactField.find().sort({ entity: 1, order: 1 });
    res.json({ data: fields });
  }),
);

// ── The record (CNT-14) ─────────────────────────────────────────────────────

/**
 * Everything the contact page needs, in one request: the record, who owns it, its custom
 * field definitions beside the values, the lists it is in, its open opportunities and
 * tasks, upcoming appointments, pinned notes, how many history entries of each kind it
 * has, and the first page of its history.
 */
router.get(
  '/:id',
  requirePermission('contacts:contact:read'),
  handler(async (req, res) => {
    const contact = await Contact.findById(req.params.id);
    if (!contact) throw notFound('Contact');

    assertTenantMatch(contact, 'contacts.get');
    const id = String(contact._id);
    const ctx = req.tenant!;

    const [
      owner,
      fieldDefinitions,
      staticLists,
      smartLists,
      opportunities,
      openTasks,
      upcomingAppointments,
      pinnedNotes,
      counts,
      history,
    ] = await Promise.all([
      memberById(ctx, contact.ownerId),
      ContactField.find({ entity: 'contact' }).sort({ order: 1 }),
      contact.listIds.length > 0 ? ContactList.find({ _id: { $in: contact.listIds } }) : [],
      ContactList.find({ type: 'smart' }),
      Opportunity.find({ contactId: id }).sort({ createdAt: -1 }),
      Task.find({ contactId: id, status: 'open' }).sort({ dueAt: 1 }),
      Appointment.find({ contactId: id, endsAt: { $gte: new Date() } }).sort({ startsAt: 1 }).limit(5),
      Activity.find({ contactId: id, pinned: true }).sort({ occurredAt: -1 }),
      historyCounts(id),
      historyFor(id, { limit: 30 }),
    ]);

    // Which smart lists this contact currently falls into: each list's filter, narrowed
    // to this one id. Cheap — a smart list is a handful of indexed conditions.
    const matching = (
      await Promise.all(
        smartLists.map(async (list) => {
          const { listId: _l, ...filter } = parseContactFilter((list.filter ?? {}) as Record<string, unknown>);
          const hit = await Contact.exists({ _id: id, ...buildContactQuery(filter, ctx) });
          return hit ? list : null;
        }),
      )
    ).filter((l): l is NonNullable<typeof l> => l !== null);

    res.json({
      ...contact.toJSON(),
      owner,
      fieldDefinitions,
      lists: [...staticLists, ...matching].map((l) => ({ id: String(l._id), name: l.name, type: l.type })),
      opportunities,
      openTasks,
      upcomingAppointments,
      pinnedNotes,
      historyCounts: counts,
      history,
    });
  }),
);

/** A page of history (CNT-15): `?type=call&before=<entry id>&limit=30`. */
router.get(
  '/:id/history',
  requirePermission('contacts:contact:read'),
  handler(async (req, res) => {
    const q = z
      .object({
        type: z.enum(ACTIVITY_TYPES).optional(),
        before: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .parse(req.query);

    if (!(await Contact.exists({ _id: req.params.id }))) throw notFound('Contact');
    res.json(await historyFor(req.params.id!, q));
  }),
);

// ── Edit ────────────────────────────────────────────────────────────────────

/**
 * Turn a partial update into dot paths for the nested objects.
 *
 * `Object.assign(contact, { address: { city } })` replaces the whole address — so
 * correcting the city silently erased the street beside it. Setting `address.city`
 * changes the one field that was sent. Parcels are the exception: the array is replaced
 * as a whole, because the client sends the full list it wants.
 */
function toPaths(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if ((key === 'address' || key === 'customFields') && value && typeof value === 'object') {
      for (const [sub, subValue] of Object.entries(value as Record<string, unknown>)) {
        if (subValue !== undefined) out[`${key}.${sub}`] = subValue;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

router.patch(
  '/:id',
  requirePermission('contacts:contact:update'),
  handler(async (req, res) => {
    const input = contactBodySchema.partial().parse(req.body);
    const ctx = req.tenant!;

    const contact = await Contact.findById(req.params.id);
    if (!contact) throw notFound('Contact');

    if (input.ownerId !== undefined) await assertOwner(ctx, input.ownerId);

    let customFields: Record<string, unknown> | undefined;
    if (input.customFields) {
      const defs = await contactFieldDefinitions();
      customFields = validateCustomFields(defs, input.customFields, { partial: true });
    }

    const before = snapshot(contact);
    const previousStatus = contact.status;

    // A legacy single `property` in an edit replaces the primary parcel, keeping the others.
    let properties: Record<string, unknown>[] | undefined = input.properties;
    if (!properties && input.property) {
      const current = contact.properties.map((p) => p.toObject() as Record<string, unknown>);
      const primaryIndex = Math.max(0, current.findIndex((p) => p.isPrimary));
      properties = current.length
        ? current.map((p, i) => (i === primaryIndex ? { ...p, ...input.property, isPrimary: true } : p))
        : [{ ...input.property, isPrimary: true }];
    }

    const { property: _legacy, ...rest } = input;
    contact.set({
      ...toPaths({ ...rest, customFields }),
      ...(properties ? { properties } : {}),
      ...(input.ownerId === null ? { ownerId: undefined } : {}),
      // Flag and status always move together — see `dnc.ts`.
      ...reconcileDnc(contact, input),
      lastActivityAt: new Date(),
    });
    if (input.email === '') contact.email = undefined;
    if (input.ownerId === null) contact.ownerId = undefined;
    await contact.save();

    // Compared against what was stored, not what was sent: clearing the flag moves the
    // status too, and that belongs on the timeline as much as a direct edit does.
    if (contact.status !== previousStatus) {
      await recordActivity({
        type: 'status_change',
        contactId: String(contact._id),
        userId: ctx.userId,
        title: `Status changed to ${contact.status.replace(/_/g, ' ')}`,
        metadata: { from: previousStatus, to: contact.status },
      });
    }

    const changes = diff(before, snapshot(contact));
    if (changes.length > 0) {
      await recordActivity({
        type: 'field_change',
        contactId: String(contact._id),
        userId: ctx.userId,
        title: `Updated ${changes.map((c) => FIELD_LABEL[c.field] ?? c.field).join(', ')}`,
        metadata: { changes },
      });
    }

    res.json(contact);
  }),
);

const FIELD_LABEL: Record<string, string> = {
  firstName: 'first name',
  lastName: 'last name',
  email: 'email',
  phone: 'phone',
  altPhones: 'alternate phones',
  company: 'company',
  source: 'source',
  ownerId: 'owner',
  tags: 'tags',
  address: 'address',
  properties: 'parcels',
  customFields: 'custom fields',
};

router.delete(
  '/:id',
  requirePermission('contacts:contact:delete'),
  handler(async (req, res) => {
    // Takes the contact's timeline and opportunities with it — see `delete.ts`.
    const removed = await deleteContacts({ _id: req.params.id });
    if (removed.contacts === 0) throw notFound('Contact');

    await AuditLog.create({
      agencyId: req.tenant!.agencyId,
      accountId: req.tenant!.accountId,
      userId: req.tenant!.userId,
      action: 'contacts.delete',
      entity: 'Contact',
      entityId: req.params.id,
      before: { ...removed },
      ip: req.ip,
    });

    res.status(204).end();
  }),
);

// ── Merge (CNT-27) ──────────────────────────────────────────────────────────

router.post(
  '/:id/merge',
  // Destroys a record, so the same permission as deleting one.
  requirePermission('contacts:contact:delete'),
  handler(async (req, res) => {
    const input = z
      .object({
        duplicateId: z.string(),
        take: z.array(z.enum(MERGEABLE_FIELDS)).default([]),
      })
      .parse(req.body);

    const survivor = await mergeContacts({
      survivorId: req.params.id!,
      duplicateId: input.duplicateId,
      take: input.take,
      userId: req.tenant!.userId,
    });

    await AuditLog.create({
      agencyId: req.tenant!.agencyId,
      accountId: req.tenant!.accountId,
      userId: req.tenant!.userId,
      action: 'contacts.merge',
      entity: 'Contact',
      entityId: String(survivor._id),
      before: { mergedId: input.duplicateId, take: input.take },
      ip: req.ip,
    });

    res.json(survivor);
  }),
);

// ── History entries written by hand ─────────────────────────────────────────

const activityBody = z.object({
  type: z.enum(['note', 'call', 'sms']).default('note'),
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(20_000).optional(),
  metadata: z.record(z.unknown()).optional(),
  occurredAt: z.coerce.date().optional(),
  pinned: z.boolean().optional(),
});

router.post(
  '/:id/activities',
  requirePermission('contacts:contact:update'),
  handler(async (req, res) => {
    const input = activityBody.parse(req.body);

    const contact = await Contact.findById(req.params.id);
    if (!contact) throw notFound('Contact');

    const title =
      input.title ??
      (input.type === 'call'
        ? `${(input.metadata?.direction as string) === 'inbound' ? 'Inbound' : 'Outbound'} call`
        : input.type === 'sms'
          ? 'Text message'
          : 'Note');

    const activity = await recordActivity({
      type: input.type,
      contactId: String(contact._id),
      userId: req.tenant!.userId,
      title,
      body: input.body,
      metadata: input.metadata,
      occurredAt: input.occurredAt,
      pinned: input.pinned,
    });

    contact.lastActivityAt = new Date();
    await contact.save();

    res.status(201).json(activity);
  }),
);

/** Pin or unpin a note, or edit its text. Only notes, and only their own fields. */
router.patch(
  '/:id/activities/:activityId',
  requirePermission('contacts:contact:update'),
  handler(async (req, res) => {
    const input = z
      .object({ pinned: z.boolean().optional(), body: z.string().max(20_000).optional() })
      .parse(req.body);

    const activity = await Activity.findOne({ _id: req.params.activityId, contactId: req.params.id });
    if (!activity) throw notFound('History entry');
    if (input.body !== undefined && activity.type !== 'note') {
      throw badRequest('Only a note can be edited; other entries record what happened');
    }

    if (input.pinned !== undefined) activity.pinned = input.pinned;
    if (input.body !== undefined) activity.body = input.body;
    await activity.save();

    res.json(activity);
  }),
);

router.delete(
  '/:id/activities/:activityId',
  requirePermission('contacts:contact:update'),
  handler(async (req, res) => {
    const activity = await Activity.findOne({ _id: req.params.activityId, contactId: req.params.id });
    if (!activity) throw notFound('History entry');
    if (activity.type !== 'note') throw badRequest('Only a note can be deleted; other entries record what happened');

    await activity.deleteOne();
    res.status(204).end();
  }),
);

// ── Lists on the record (CNT-26) ────────────────────────────────────────────

async function changeListMembership(
  contactId: string,
  listId: string,
  change: 'added' | 'removed',
  userId: string,
) {
  const [contact, list] = await Promise.all([Contact.findById(contactId), ContactList.findById(listId)]);
  if (!contact) throw notFound('Contact');
  if (!list) throw notFound('List');
  if (list.type !== 'static') throw badRequest('A smart list fills itself from its conditions');

  await Contact.updateOne(
    { _id: contact._id },
    change === 'added' ? { $addToSet: { listIds: String(list._id) } } : { $pull: { listIds: String(list._id) } },
  );

  await recordActivity({
    type: 'list_change',
    contactId: String(contact._id),
    userId,
    title: `${change === 'added' ? 'Added to' : 'Removed from'} ${list.name}`,
    metadata: { listId: String(list._id), listName: list.name, change },
  });
}

router.post(
  '/:id/lists/:listId',
  requirePermission('contacts:contact:update'),
  handler(async (req, res) => {
    await changeListMembership(req.params.id!, req.params.listId!, 'added', req.tenant!.userId);
    res.status(204).end();
  }),
);

router.delete(
  '/:id/lists/:listId',
  requirePermission('contacts:contact:update'),
  handler(async (req, res) => {
    await changeListMembership(req.params.id!, req.params.listId!, 'removed', req.tenant!.userId);
    res.status(204).end();
  }),
);

// ── Bulk actions (CNT-03, CNT-33) ───────────────────────────────────────────

const BULK_ACTIONS = [
  'tag',
  'untag',
  'status',
  'dnc',
  'addToList',
  'removeFromList',
  'assignOwner',
  'setSource',
  'delete',
] as const;

const bulkSchema = z
  .object({
    action: z.enum(BULK_ACTIONS),
    value: z.string().max(200).optional(),
    /** Explicit selection. Mutually exclusive with `filter`. */
    ids: z.array(z.string()).max(10_000).optional(),
    /** Act on everything matching the current view instead of a selection. */
    filter: z.record(z.unknown()).optional(),
    /**
     * How many records the caller believes it is about to affect.
     * Required for filter-based deletes; the request is rejected if it does not match.
     */
    expectedCount: z.number().int().nonnegative().optional(),
  })
  .refine((v) => (v.ids?.length ?? 0) > 0 || v.filter !== undefined, {
    message: 'Provide either ids or a filter',
  });

/**
 * Apply one action to many contacts.
 *
 * Accepts either an explicit id list or a filter, so "select all 4,312 matching" does not
 * have to ship 4,312 ids to the server. Either way the tenancy plugin scopes the update,
 * so ids belonging to another sub-account simply match nothing.
 */
router.post(
  '/bulk',
  requirePermission('contacts:contact:update'),
  handler(async (req, res) => {
    const input = bulkSchema.parse(req.body);
    const ctx = req.tenant!;

    // Delete is the one action that needs a stronger permission than the route's.
    if (input.action === 'delete' && !hasPermission(ctx.permissions, 'contacts:contact:delete')) {
      throw forbidden('Missing permission: contacts:contact:delete');
    }

    const byIds = (input.ids?.length ?? 0) > 0;

    /**
     * An absent or entirely empty filter matches every contact in the sub-account.
     * That is a reasonable thing to *read*, and a catastrophic thing to delete: one
     * malformed request would erase a client's whole database with no way back.
     * Destructive bulk actions therefore require an explicit selection or a filter
     * that genuinely narrows.
     */
    if (input.action === 'delete' && !byIds && isEmptyContactFilter(input.filter as never)) {
      throw badRequest(
        'Refusing to delete every contact in this sub-account. Select the contacts to ' +
          'delete, or apply a filter first.',
      );
    }

    const query = byIds ? { _id: { $in: input.ids } } : await resolveContactQuery(input.filter ?? {}, ctx);
    const touched = { lastActivityAt: new Date() };

    switch (input.action) {
      case 'delete': {
        // A filter-based delete must agree with what the caller was shown. If the set
        // changed between rendering and clicking, the request is rejected rather than
        // silently deleting more than the user saw.
        if (!byIds) {
          const actual = await Contact.countDocuments(query);
          if (input.expectedCount === undefined) {
            throw badRequest(`This would delete ${actual.toLocaleString()} contacts. Confirm the count to proceed.`);
          }
          if (input.expectedCount !== actual) {
            throw conflict(
              `The list changed: you were shown ${input.expectedCount.toLocaleString()} contacts ` +
                `but ${actual.toLocaleString()} now match. Refresh and try again.`,
            );
          }
        }

        const removed = await deleteContacts(query);

        // Deletion is the one bulk action that cannot be undone, so it is always recorded —
        // including what went with the contacts, since that is gone too.
        await AuditLog.create({
          agencyId: ctx.agencyId,
          accountId: ctx.accountId,
          userId: ctx.userId,
          action: 'contacts.bulk.delete',
          entity: 'Contact',
          before: {
            count: removed.contacts,
            activities: removed.activities,
            opportunities: removed.opportunities,
            ...(byIds ? { ids: input.ids } : { filter: input.filter }),
          },
          ip: req.ip,
        });

        res.json({ action: 'delete', affected: removed.contacts, opportunities: removed.opportunities });
        return;
      }

      case 'tag': {
        if (!input.value) throw badRequest('A tag is required');
        // $addToSet rather than $push so re-tagging is idempotent.
        const result = await Contact.updateMany(query, { $addToSet: { tags: input.value }, $set: touched });
        res.json({ action: 'tag', affected: result.modifiedCount ?? 0 });
        return;
      }

      case 'untag': {
        if (!input.value) throw badRequest('A tag is required');
        const result = await Contact.updateMany(query, { $pull: { tags: input.value } });
        res.json({ action: 'untag', affected: result.modifiedCount ?? 0 });
        return;
      }

      case 'status': {
        const status = z.enum(CONTACT_STATUSES).parse(input.value);
        // The status and the flag the dialer checks are one fact. The same pair for every
        // selected contact, so `reconcileDnc` is asked once rather than per row.
        const result = await Contact.updateMany(query, { $set: { ...reconcileDnc({}, { status }), ...touched } });
        res.json({ action: 'status', affected: result.modifiedCount ?? 0 });
        return;
      }

      case 'dnc': {
        if (input.value !== 'false') {
          const result = await Contact.updateMany(query, { $set: { ...reconcileDnc({}, { dnc: true }), ...touched } });
          res.json({ action: 'dnc', affected: result.modifiedCount ?? 0 });
          return;
        }

        // Lifting the flag has two outcomes depending on the row: a contact whose status
        // *is* do-not-call needs somewhere to go back to, the rest keep the status they have.
        const moved = await Contact.updateMany(
          { $and: [query, { status: 'do_not_call' }] },
          { $set: { dnc: false, status: DNC_CLEARED_STATUS, ...touched } },
        );
        const cleared = await Contact.updateMany({ $and: [query, { dnc: true }] }, { $set: { dnc: false, ...touched } });
        res.json({ action: 'dnc', affected: (moved.modifiedCount ?? 0) + (cleared.modifiedCount ?? 0) });
        return;
      }

      case 'addToList':
      case 'removeFromList': {
        if (!input.value) throw badRequest('A list is required');

        const list = await ContactList.findById(input.value);
        if (!list) throw notFound('List');
        if (list.type === 'smart') {
          throw badRequest('Smart lists build themselves from a filter and cannot take manual members');
        }

        // One write, however many contacts match: membership lives on the contact.
        const result =
          input.action === 'addToList'
            ? await Contact.updateMany(query, { $addToSet: { listIds: String(list._id) } })
            : await Contact.updateMany(query, { $pull: { listIds: String(list._id) } });

        res.json({ action: input.action, affected: result.matchedCount ?? 0 });
        return;
      }

      case 'assignOwner': {
        const ownerId = input.value && input.value !== 'none' ? input.value : null;
        await assertOwner(ctx, ownerId);
        const result = await Contact.updateMany(
          query,
          ownerId ? { $set: { ownerId, ...touched } } : { $unset: { ownerId: '' }, $set: touched },
        );
        res.json({ action: 'assignOwner', affected: result.modifiedCount ?? 0 });
        return;
      }

      case 'setSource': {
        if (!input.value) throw badRequest('A source is required');
        const result = await Contact.updateMany(query, { $set: { source: input.value } });
        res.json({ action: 'setSource', affected: result.modifiedCount ?? 0 });
        return;
      }
    }
  }),
);

// ── Lists (CNT-30, CNT-34) ──────────────────────────────────────────────────

/**
 * How many contacts each list holds, counted now.
 *
 * Nothing is stored, so nothing goes stale: deleting a contact, or a contact's status
 * moving it out of a smart list's filter, is reflected the next time the lists are read.
 * Static lists are counted together in one grouped pass; a smart list is a count of its
 * own filter.
 */
async function memberCounts(
  lists: { _id: unknown; type?: string | null; filter?: unknown }[],
  ctx: { userId: string },
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  const staticIds = lists.filter((l) => l.type !== 'smart').map((l) => String(l._id));
  if (staticIds.length > 0) {
    const rows: { _id: string; n: number }[] = await Contact.aggregate([
      { $match: { listIds: { $in: staticIds } } },
      { $unwind: '$listIds' },
      { $match: { listIds: { $in: staticIds } } },
      { $group: { _id: '$listIds', n: { $sum: 1 } } },
    ]);
    for (const row of rows) counts.set(row._id, row.n);
  }

  await Promise.all(
    lists
      .filter((l) => l.type === 'smart')
      .map(async (l) => {
        const { listId: _l, ...filter } = parseContactFilter((l.filter ?? {}) as Record<string, unknown>);
        counts.set(String(l._id), await Contact.countDocuments(buildContactQuery(filter, ctx)));
      }),
  );

  return counts;
}

/** A list as the API returns it: the stored document plus its live member count. */
async function withCount<T extends { _id: unknown; toJSON(): Record<string, unknown> }>(list: T, ctx: { userId: string }) {
  const counts = await memberCounts([list as never], ctx);
  return { ...list.toJSON(), memberCount: counts.get(String(list._id)) ?? 0 };
}

router.get(
  '/lists/all',
  requirePermission('contacts:list:read'),
  handler(async (req, res) => {
    const lists = await ContactList.find().sort({ createdAt: -1 });
    const counts = await memberCounts(lists, req.tenant!);

    res.json({
      data: lists.map((l) => ({ ...l.toJSON(), memberCount: counts.get(String(l._id)) ?? 0 })),
    });
  }),
);

const listBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  type: z.enum(['static', 'smart']).default('static'),
  filter: smartListFilterSchema.optional(),
  memberIds: z.array(z.string()).max(10_000).optional(),
});

router.post(
  '/lists',
  requirePermission('contacts:list:manage'),
  handler(async (req, res) => {
    const { memberIds, ...input } = listBodySchema.parse(req.body);
    if (input.type === 'smart' && !input.filter) throw badRequest('A smart list needs a filter');

    const list = await ContactList.create({ ...input, filter: input.type === 'smart' ? input.filter : undefined });

    // Initial members of a static list are recorded on the contacts themselves. The
    // tenancy plugin scopes the update, so an id from another sub-account matches nothing.
    if (list.type === 'static' && memberIds && memberIds.length > 0) {
      await Contact.updateMany({ _id: { $in: memberIds } }, { $addToSet: { listIds: String(list._id) } });
    }

    res.status(201).json(await withCount(list, req.tenant!));
  }),
);

router.patch(
  '/lists/:id',
  requirePermission('contacts:list:manage'),
  handler(async (req, res) => {
    // Members are changed through the bulk actions, not by resubmitting the list; the type
    // is fixed, because a static list's members and a smart list's filter are different shapes.
    const input = listBodySchema.partial().omit({ type: true, memberIds: true }).parse(req.body);

    const list = await ContactList.findById(req.params.id);
    if (!list) throw notFound('List');
    if (input.filter && list.type !== 'smart') throw badRequest('A static list has no filter');

    Object.assign(list, input);
    await list.save();

    res.json(await withCount(list, req.tenant!));
  }),
);

/** A copy, with "(copy)" on the name; a static list's members come along. */
router.post(
  '/lists/:id/duplicate',
  requirePermission('contacts:list:manage'),
  handler(async (req, res) => {
    const source = await ContactList.findById(req.params.id);
    if (!source) throw notFound('List');

    const copy = await ContactList.create({
      name: `${source.name} (copy)`,
      description: source.description,
      type: source.type,
      filter: source.filter,
    });

    if (source.type === 'static') {
      await Contact.updateMany({ listIds: String(source._id) }, { $addToSet: { listIds: String(copy._id) } });
    }

    res.status(201).json(await withCount(copy, req.tenant!));
  }),
);

router.delete(
  '/lists/:id',
  requirePermission('contacts:list:manage'),
  handler(async (req, res) => {
    const result = await ContactList.deleteOne({ _id: req.params.id });
    if (result.deletedCount === 0) throw notFound('List');

    // Only the grouping is removed; the contacts themselves are untouched, apart from
    // forgetting that they were in it.
    await Contact.updateMany({ listIds: req.params.id }, { $pull: { listIds: req.params.id } });

    res.status(204).end();
  }),
);

// ── Custom field definitions ────────────────────────────────────────────────

const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'currency',
  'date',
  'select',
  'multiselect',
  'checkbox',
  'email',
  'phone',
  'url',
] as const;

const fieldBodySchema = z.object({
  entity: z.enum(['contact', 'opportunity']).default('contact'),
  label: z.string().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().min(1).max(80)).max(50).optional(),
  required: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
});

router.post(
  '/fields',
  requirePermission('contacts:field:manage'),
  handler(async (req, res) => {
    const input = fieldBodySchema.parse(req.body);

    if ((input.type === 'select' || input.type === 'multiselect') && !input.options?.length) {
      throw badRequest('Choice fields need at least one option');
    }

    // The key is what `customFields` is stored under, so it must be stable and safe to
    // use as a Mongo path. Derived from the label once, at creation, then never changed —
    // renaming the label later must not orphan existing values.
    const key = slugify(input.label);
    if (!key) throw badRequest('That label does not produce a usable field key');

    const clash = await ContactField.findOne({ entity: input.entity, key });
    if (clash) throw badRequest(`A ${input.entity} field named "${input.label}" already exists`);

    const field = await ContactField.create({ ...input, key });
    res.status(201).json(field);
  }),
);

router.patch(
  '/fields/:id',
  requirePermission('contacts:field:manage'),
  handler(async (req, res) => {
    // `key` and `entity` are deliberately not updatable — both would strand stored values.
    const input = fieldBodySchema.partial().omit({ entity: true }).parse(req.body);

    const field = await ContactField.findById(req.params.id);
    if (!field) throw notFound('Field');

    Object.assign(field, input);
    await field.save();

    res.json(field);
  }),
);

router.delete(
  '/fields/:id',
  requirePermission('contacts:field:manage'),
  handler(async (req, res) => {
    const field = await ContactField.findById(req.params.id);
    if (!field) throw notFound('Field');

    await ContactField.deleteOne({ _id: req.params.id });

    // Values are left on the contacts. Deleting a definition hides the field; stripping
    // it from every record would make the action unrecoverable for a mis-click.
    res.status(204).end();
  }),
);

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

export const contactsModule: ApiModule = { key: 'contacts', router };
export type { ActivityType };
