import { z } from 'zod';
import { parseContactFilter, type ContactFilter } from '@/shared';
import { paginationSchema } from '../../core/pagination';
import { notFound } from '../../core/errors';
import { ContactList } from '../../models';
import { searchConditions } from './search';

/**
 * One definition of "what the user is currently looking at".
 *
 * The list, export, bulk and smart-list code all build their query from the shared
 * `ContactFilter` through this file, so a bulk delete or an export can never act on a
 * different set than the table showed. The shape itself — what the keys mean, how they are
 * parsed from a URL or a stored list — lives in `src/shared/contact-filter`; this
 * file only turns it into Mongo.
 */

export const contactListQuerySchema = paginationSchema.passthrough();

/** Who is asking, for `ownerId: 'me'`. */
export interface FilterContext {
  userId: string;
}

/** Fields the table may sort by. Anything else falls back to recency. */
export const SORTABLE_FIELDS = new Set([
  'firstName',
  'lastName',
  'status',
  'createdAt',
  'lastActivityAt',
  'property.acres',
  'property.assessedValue',
  'property.county',
  'property.state',
  'ownerId',
  'source',
]);

const PRESENT = { $exists: true, $nin: [null, ''] };
const ABSENT = { $in: [null, ''] };

/**
 * Build the Mongo query fragment for a filter.
 *
 * Tenant scoping is NOT applied here — the Mongoose plugin adds agencyId/accountId to
 * every query automatically. This only narrows within the tenant. Parcel conditions match
 * *any* of a contact's parcels, so an owner with a 2-acre lot and a 40-acre tract is found
 * by "at least 20 acres".
 */
export function buildContactQuery(filter: ContactFilter, ctx: FilterContext): Record<string, unknown> {
  const f = parseContactFilter(filter as Record<string, unknown>);
  const query: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];

  if (f.status) query.status = { $in: f.status };
  if (f.tags) query.tags = f.tagMode === 'all' ? { $all: f.tags } : { $in: f.tags };
  if (f.dnc !== undefined) query.dnc = f.dnc;
  if (f.source) query.source = { $in: f.source };

  if (f.ownerId === 'me') query.ownerId = ctx.userId;
  else if (f.ownerId === 'none') query.ownerId = ABSENT;
  else if (f.ownerId) query.ownerId = f.ownerId;

  const parcel: Record<string, unknown> = {};
  if (f.state) parcel.state = { $in: f.state };
  if (f.county) parcel.county = { $in: f.county };
  if (f.acresMin !== undefined || f.acresMax !== undefined) {
    parcel.acres = {
      ...(f.acresMin !== undefined ? { $gte: f.acresMin } : {}),
      ...(f.acresMax !== undefined ? { $lte: f.acresMax } : {}),
    };
  }
  if (f.valueMin !== undefined || f.valueMax !== undefined) {
    parcel.assessedValue = {
      ...(f.valueMin !== undefined ? { $gte: f.valueMin } : {}),
      ...(f.valueMax !== undefined ? { $lte: f.valueMax } : {}),
    };
  }
  if (Object.keys(parcel).length > 0) query.properties = { $elemMatch: parcel };

  if (f.createdAfter || f.createdBefore) {
    query.createdAt = {
      ...(f.createdAfter ? { $gte: new Date(f.createdAfter) } : {}),
      ...(f.createdBefore ? { $lte: endOfDay(f.createdBefore) } : {}),
    };
  }
  if (f.activityAfter || f.activityBefore) {
    query.lastActivityAt = {
      ...(f.activityAfter ? { $gte: new Date(f.activityAfter) } : {}),
      ...(f.activityBefore ? { $lte: endOfDay(f.activityBefore) } : {}),
    };
  }

  if (f.hasEmail === true) query.email = PRESENT;
  if (f.hasEmail === false) query.email = ABSENT;
  if (f.hasPhone === true) query.phone = PRESENT;
  if (f.hasPhone === false) query.phone = ABSENT;

  for (const [key, value] of Object.entries(f.customFields ?? {})) {
    // Equality; for a multiselect (stored as an array) Mongo's equality matches an element.
    query[`customFields.${key}`] = value;
  }

  and.push(...searchConditions(f.search));
  if (and.length > 0) query.$and = and;

  return query;
}

/** A day given as `YYYY-MM-DD` should include the whole of that day. */
function endOfDay(value: string): Date {
  const d = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) d.setUTCHours(23, 59, 59, 999);
  return d;
}

/**
 * Resolve the full query for a filter, including any list restriction.
 *
 * A static list narrows to its members; a smart list intersects its stored filter with
 * whatever else is being asked — viewing "Hot leads" filtered to Texas shows the hot leads
 * in Texas, not every hot lead.
 */
export async function resolveContactQuery(
  input: Record<string, unknown>,
  ctx: FilterContext,
): Promise<Record<string, unknown>> {
  const filter = parseContactFilter(input);
  const { listId, ...rest } = filter;
  const query = buildContactQuery(rest, ctx);

  if (!listId) return query;

  const list = await ContactList.findById(listId);
  if (!list) throw notFound('List');

  if (list.type === 'static') {
    return { ...query, listIds: String(list._id) };
  }

  // A smart list's own filter never names a list, so this cannot recurse.
  const { listId: _nested, ...stored } = parseContactFilter((list.filter ?? {}) as Record<string, unknown>);
  return { $and: [query, buildContactQuery(stored, ctx)] };
}

/** The filter a smart list may store: anything parseable, never empty, never naming a list. */
export const smartListFilterSchema = z
  .record(z.unknown())
  .transform((raw) => {
    const { listId: _listId, ...filter } = parseContactFilter(raw);
    return filter;
  })
  .refine((f) => Object.keys(f).length > 0, {
    message: 'A smart list needs at least one condition, or it would match every contact',
  });
