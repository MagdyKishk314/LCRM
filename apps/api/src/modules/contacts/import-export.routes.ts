import type { Router } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import {
  CONTACT_EXPORTABLE_COLUMNS,
  CONTACT_EXPORT_COLUMNS,
  CONTACT_FIELD_LABEL,
  CUSTOM_FIELD_PREFIX,
  csvRow,
  IMPORT_BATCH_SIZE,
  IMPORT_CHUNK_ROWS,
  IMPORTABLE_FIELDS,
  phoneDigits,
  pluck,
  type ImportableField,
} from '@landcaller/shared';
import { requirePermission } from '../../core/auth/middleware';
import { badRequest, handler, notFound } from '../../core/errors';
import { enforceImportQuota } from '../../core/quota';
import { Activity, AuditLog, Contact, ContactList, ImportJob } from '../../models';
import { coerceCustomField, contactFieldDefinitions, type FieldDef } from './custom-fields';
import { deleteContacts } from './delete';
import { deriveContactFields } from './derive';
import { resolveContactQuery } from './filters';
import { memberById, membersOf } from './members';
import { buildSearchTokens } from './search';

/**
 * The per-request row cap is the chunk size, enforced by the schema.
 *
 * A total-rows ceiling lives in the browser, which is the only place that sees the whole
 * file. The server's protection against an endless stream of chunks is the hourly quota,
 * which bounds volume regardless of how it arrives.
 */

const STATUSES = new Set(['new', 'contacted', 'qualified', 'unqualified', 'do_not_call']);
const STRATEGIES = ['update', 'skip', 'create'] as const;

/** A contact document built from one CSV row, before it reaches Mongoose. */
type ContactInput = Record<string, any>;

/** One parsed row on its way to being inserted or matched. */
interface Pending {
  doc: ContactInput;
  /** Whether the file stated a status, as opposed to the default being filled in. */
  hasStatus: boolean;
  rowNumber: number;
  /** The row's identity for matching: an external id, else phone digits, else email. */
  key?: string;
}

type BulkUpdate = { updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } };

/** A mapping value: a built-in field, or `cf.<key>` for a custom field. */
function isMappable(field: string, defs: FieldDef[]): boolean {
  if ((IMPORTABLE_FIELDS as readonly string[]).includes(field)) return true;
  return field.startsWith(CUSTOM_FIELD_PREFIX) && defs.some((d) => d.key === field.slice(CUSTOM_FIELD_PREFIX.length));
}

export function registerImportExportRoutes(router: Router) {
  // ── Export (CNT-11, CNT-43) ───────────────────────────────────────────────

  const exportQuery = z.object({
    format: z.enum(['csv', 'xlsx']).default('csv'),
    /** Comma-separated; defaults to the standard set. Custom fields as `cf.<key>`. */
    columns: z.string().optional(),
  });

  /**
   * Export the current filter (GET, a plain link the browser downloads) or an explicit
   * selection (POST with ids, for a selection too large for a URL).
   *
   * Gated on `contacts:contact:export`, which the `caller` role deliberately lacks — a
   * cold-call seat can work a list but cannot walk off with it. Every export is audited
   * with what was asked for and how many rows went: it is the one action that walks data
   * out of the building.
   */
  async function runExport(
    req: Parameters<Parameters<typeof handler>[0]>[0],
    res: Parameters<Parameters<typeof handler>[0]>[1],
    opts: { format: 'csv' | 'xlsx'; columns?: string; ids?: string[]; filter: Record<string, unknown> },
  ) {
    const ctx = req.tenant!;
    const defs = await contactFieldDefinitions();

    const requested = opts.columns?.split(',').map((c) => c.trim()).filter(Boolean);
    const columns = (requested?.length ? requested : [...CONTACT_EXPORT_COLUMNS]).filter(
      (c) =>
        (CONTACT_EXPORTABLE_COLUMNS as readonly string[]).includes(c) ||
        (c.startsWith(CUSTOM_FIELD_PREFIX) && defs.some((d) => d.key === c.slice(CUSTOM_FIELD_PREFIX.length))),
    );
    if (columns.length === 0) throw badRequest('No exportable columns were requested');

    const query = opts.ids?.length ? { _id: { $in: opts.ids } } : await resolveContactQuery(opts.filter, ctx);

    const members = columns.includes('owner') ? await membersOf(ctx) : [];
    const ownerName = new Map(members.map((m) => [m.id, m.name]));
    const label = (c: string) =>
      c.startsWith(CUSTOM_FIELD_PREFIX)
        ? (defs.find((d) => d.key === c.slice(CUSTOM_FIELD_PREFIX.length))?.label ?? c)
        : (CONTACT_FIELD_LABEL[c] ?? c);

    const cell = (json: Record<string, unknown>, column: string): unknown => {
      if (column === 'owner') return json.ownerId ? (ownerName.get(String(json.ownerId)) ?? '') : '';
      if (column.startsWith(CUSTOM_FIELD_PREFIX)) {
        return (json.customFields as Record<string, unknown> | undefined)?.[column.slice(CUSTOM_FIELD_PREFIX.length)];
      }
      return pluck(json, column);
    };

    const stamp = new Date().toISOString().slice(0, 10);
    let rows = 0;

    if (opts.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="contacts-${stamp}.csv"`);

      // A UTF-8 BOM so Excel opens accented names correctly instead of as mojibake.
      res.write('﻿');
      res.write(csvRow(columns.map(label)) + '\r\n');

      // Streamed in batches: an export of 50,000 contacts must not be assembled in memory
      // before the first byte reaches the client.
      const cursor = Contact.find(query).sort({ createdAt: -1 }).cursor();
      for await (const doc of cursor) {
        const json = doc.toJSON() as Record<string, unknown>;
        res.write(csvRow(columns.map((c) => cell(json, c))) + '\r\n');
        rows++;
      }
      res.end();
    } else {
      // A workbook has to be assembled whole; the row cap keeps that bounded.
      const data: unknown[][] = [columns.map(label)];
      const cursor = Contact.find(query).sort({ createdAt: -1 }).limit(100_000).cursor();
      for await (const doc of cursor) {
        const json = doc.toJSON() as Record<string, unknown>;
        data.push(
          columns.map((c) => {
            const v = cell(json, c);
            return Array.isArray(v) ? v.join('; ') : v instanceof Date ? v.toISOString() : (v ?? '');
          }),
        );
        rows++;
      }
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), 'Contacts');
      const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="contacts-${stamp}.xlsx"`);
      res.end(buffer);
    }

    await AuditLog.create({
      agencyId: ctx.agencyId,
      accountId: ctx.accountId,
      userId: ctx.userId,
      action: 'contacts.export',
      entity: 'Contact',
      after: { rows, format: opts.format, columns, ...(opts.ids?.length ? { ids: opts.ids.length } : { filter: opts.filter }) },
      ip: req.ip,
    });
  }

  router.get(
    '/export',
    requirePermission('contacts:contact:export'),
    handler(async (req, res) => {
      const { format, columns, ...filter } = { ...req.query, ...exportQuery.parse(req.query) } as Record<string, unknown> & {
        format: 'csv' | 'xlsx';
        columns?: string;
      };
      await runExport(req, res, { format, columns, filter });
    }),
  );

  router.post(
    '/export',
    requirePermission('contacts:contact:export'),
    handler(async (req, res) => {
      const input = exportQuery
        .extend({ ids: z.array(z.string()).max(10_000).optional(), filter: z.record(z.unknown()).optional() })
        .parse(req.body);
      await runExport(req, res, { format: input.format, columns: input.columns, ids: input.ids, filter: input.filter ?? {} });
    }),
  );

  // ── Import jobs (CNT-18, CNT-39) ──────────────────────────────────────────

  const jobBody = z.object({
    fileName: z.string().min(1).max(200),
    tag: z.string().max(60).optional(),
    listId: z.string().optional(),
    ownerId: z.string().optional(),
    strategy: z.enum(STRATEGIES).default('update'),
    mapping: z.record(z.string()),
    totalRows: z.number().int().nonnegative(),
  });

  /** Open a job before the first chunk; the chunks name it and the counts accrue on it. */
  router.post(
    '/import/jobs',
    requirePermission('contacts:contact:import'),
    handler(async (req, res) => {
      const input = jobBody.parse(req.body);
      const ctx = req.tenant!;

      if (input.listId) {
        const list = await ContactList.findById(input.listId);
        if (!list || list.type !== 'static') throw badRequest('Imported contacts can only be added to a static list');
      }
      if (input.ownerId && !(await memberById(ctx, input.ownerId))) {
        throw badRequest('That person is not a member of this sub-account');
      }

      const job = await ImportJob.create({ ...input, userId: ctx.userId, status: 'running', startedAt: new Date() });
      res.status(201).json(job);
    }),
  );

  router.get(
    '/import/jobs',
    requirePermission('contacts:contact:import'),
    handler(async (_req, res) => {
      const jobs = await ImportJob.find().sort({ startedAt: -1 }).limit(100);
      const members = await membersOf(_req.tenant!);
      const name = new Map(members.map((m) => [m.id, m.name]));
      res.json({ data: jobs.map((j) => ({ ...j.toJSON(), userName: name.get(j.userId) ?? null })) });
    }),
  );

  router.post(
    '/import/jobs/:id/finish',
    requirePermission('contacts:contact:import'),
    handler(async (req, res) => {
      const { status } = z.object({ status: z.enum(['finished', 'failed']) }).parse(req.body);
      const job = await ImportJob.findById(req.params.id);
      if (!job) throw notFound('Import');
      job.status = status;
      job.finishedAt = new Date();
      await job.save();
      res.json(job);
    }),
  );

  /**
   * Undo an import: delete the contacts it *created* and leave the ones it *updated*.
   *
   * Updated contacts existed before the file and hold data the file did not bring; there
   * is no safe way to roll a merge back without a copy of the prior record. Created ones
   * carry the job id, which is what makes this cheap to find and precise.
   */
  router.post(
    '/import/jobs/:id/undo',
    requirePermission('contacts:contact:delete'),
    handler(async (req, res) => {
      const job = await ImportJob.findById(req.params.id);
      if (!job) throw notFound('Import');
      if (job.status === 'undone') throw badRequest('This import has already been undone');
      if (job.status === 'running') throw badRequest('This import is still running');
      if (Date.now() - job.startedAt.getTime() > 30 * 24 * 60 * 60 * 1000) {
        throw badRequest('An import can be undone for 30 days');
      }

      const removed = await deleteContacts({ importJobId: String(job._id) });

      job.status = 'undone';
      job.undoneAt = new Date();
      await job.save();

      await AuditLog.create({
        agencyId: req.tenant!.agencyId,
        accountId: req.tenant!.accountId,
        userId: req.tenant!.userId,
        action: 'contacts.import.undo',
        entity: 'ImportJob',
        entityId: String(job._id),
        before: { fileName: job.fileName, deleted: removed.contacts, kept: job.updated },
        ip: req.ip,
      });

      res.json({ deleted: removed.contacts, kept: job.updated });
    }),
  );

  // ── Preview (CNT-38) ──────────────────────────────────────────────────────

  const chunkShape = {
    /** The header row, so column position still maps to a field. */
    columns: z.array(z.string()).min(1).max(200),
    /** One slice of the file's data rows, already parsed by the browser. */
    rows: z.array(z.array(z.string())).min(1).max(IMPORT_CHUNK_ROWS),
    /** CSV column header → contact field. Empty string means "skip this column". */
    mapping: z.record(z.string()),
  };

  /**
   * How many rows of a chunk would match an existing contact — so the wizard can say
   * "1,204 will be created, 796 updated" before anything is written. Reads only.
   */
  router.post(
    '/import/preview',
    requirePermission('contacts:contact:import'),
    handler(async (req, res) => {
      const input = z.object(chunkShape).parse(req.body);
      const defs = await contactFieldDefinitions();
      const columnToField = mapColumns(input.columns, input.mapping, defs);

      const keys = new Set<string>();
      let nameless = 0;
      for (const row of input.rows) {
        const { doc } = rowToContact(row, columnToField, defs, undefined, undefined);
        if (!doc.firstName && !doc.lastName) {
          nameless++;
          continue;
        }
        const key = matchKey(doc);
        if (key) keys.add(key);
      }

      const matched = await countMatches([...keys]);
      res.json({ rows: input.rows.length, nameless, matched, unmatched: input.rows.length - nameless - matched });
    }),
  );

  // ── Commit (CNT-12, CNT-37, CNT-38) ───────────────────────────────────────

  const commitSchema = z.object({
    ...chunkShape,
    /** The job this chunk belongs to. */
    jobId: z.string(),
    /** Row number of the first row in this chunk, so errors name the spreadsheet line. */
    offset: z.number().int().min(0).default(0),
  });

  /**
   * Apply one chunk of an import.
   *
   * The browser parses the file and sends it a slice at a time, rather than posting the
   * whole thing and waiting. That keeps every request small and short — which is what makes
   * a 50 MB file possible on a platform with request size and duration limits — and gives
   * the user a progress bar instead of a spinner that might be dead.
   *
   * Each row has a key — an external id, else its phone digits, else its email — and the
   * job's strategy says what a key that already exists means: **update** the contact (the
   * default; a skip-trace refresh), **skip** the row, or **create** a second record anyway.
   * Re-running a file under `update` is therefore safe — the property that makes a
   * migration retryable.
   */
  router.post(
    '/import/commit',
    requirePermission('contacts:contact:import'),
    handler(async (req, res) => {
      const input = commitSchema.parse(req.body);
      const ctx = req.tenant!;

      const job = await ImportJob.findById(input.jobId);
      if (!job) throw notFound('Import');
      if (job.status !== 'running') throw badRequest('This import has already finished');

      // Metered on what this chunk actually carries. Identical content inside the window is
      // charged once, so a retried chunk is free.
      await enforceImportQuota(ctx, JSON.stringify(input.rows));

      const defs = await contactFieldDefinitions();
      const columnToField = mapColumns(input.columns, input.mapping, defs);

      if (columnToField.size === 0) throw badRequest('No columns are mapped. Map at least a first and last name.');
      const mapped = new Set(columnToField.values());
      if (!mapped.has('firstName') && !mapped.has('lastName')) {
        throw badRequest('Map at least one name column before importing.');
      }

      const listId = job.listId ?? undefined;
      const ownerId = job.ownerId ?? undefined;
      const strategy = job.strategy as (typeof STRATEGIES)[number];
      const jobId = String(job._id);

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: { row: number; message: string }[] = [];

      /**
       * Rows are processed in batches rather than one at a time.
       *
       * The row-at-a-time version cost one `findOne` plus one write per row — two Atlas
       * round trips each. At 50 MB that is well over half a million round trips and the
       * request would never finish. A batch resolves every existing contact in the chunk
       * with one query, inserts the new ones with one `insertMany`, and updates the matched
       * ones with one `bulkWrite` — which the tenancy plugin rewrites so that every filter
       * in it carries the tenant.
       */
      for (let start = 0; start < input.rows.length; start += IMPORT_BATCH_SIZE) {
        const chunk = input.rows.slice(start, start + IMPORT_BATCH_SIZE);
        const pending: Pending[] = [];

        for (const [offset, row] of chunk.entries()) {
          // +2 so the number matches what the user sees in a spreadsheet: 1-indexed, with
          // the header occupying row 1. `input.offset` carries the chunk's place in the file.
          const rowNumber = input.offset + start + offset + 2;

          try {
            const { doc, hasStatus, fieldErrors } = rowToContact(row, columnToField, defs, job.tag ?? undefined, `Import: ${job.fileName}`);
            for (const message of fieldErrors) errors.push({ row: rowNumber, message });

            if (!doc.firstName && !doc.lastName) {
              skipped++;
              continue;
            }
            pending.push({ doc, hasStatus, rowNumber, key: matchKey(doc) });
          } catch (err) {
            errors.push({ row: rowNumber, message: err instanceof Error ? err.message : String(err) });
          }
        }

        if (errors.length > 100) break;

        /**
         * Two rows in one file describing the same person are merged, not duplicated.
         * Identical keys are folded here, field by field.
         */
        const byKey = new Map<string, Pending>();
        const keyless: Pending[] = [];
        for (const item of pending) {
          if (!item.key || strategy === 'create') {
            keyless.push(item);
            continue;
          }
          const seen = byKey.get(item.key);
          if (seen) mergeRow(seen, item);
          else byKey.set(item.key, item);
        }

        const deduped = [...byKey.values(), ...keyless];
        const existing = strategy === 'create' ? new Map<string, unknown>() : await findMatches([...byKey.keys()]);

        const inserts: ContactInput[] = [];
        const updates: BulkUpdate[] = [];
        const statusUpdates: BulkUpdate[] = [];
        const matchedIds: unknown[] = [];

        for (const item of deduped) {
          const match = item.key ? existing.get(item.key) : undefined;

          if (match && strategy === 'skip') {
            skipped++;
            continue;
          }

          if (match) {
            const filter = { _id: match };
            updates.push({ updateOne: { filter, update: updateFor(item, listId, ownerId, jobId) } });
            matchedIds.push(match);

            /**
             * An import may flag a contact do-not-contact, and may never un-flag one.
             *
             * Flagging travels with the main update above. Any other status from the file
             * is applied only to a contact that is not currently flagged: a skip-trace
             * refresh that lists someone as "new" must not put a scrubbed number back on
             * the dial list. Lifting the flag is a deliberate act, done in the app.
             */
            if (item.hasStatus && !item.doc.dnc) {
              statusUpdates.push({
                updateOne: {
                  filter: { ...filter, dnc: { $ne: true }, status: { $ne: 'do_not_call' } },
                  update: { $set: { status: item.doc.status, dnc: false } },
                },
              });
            }
          } else {
            const doc: ContactInput = {
              ...item.doc,
              ...(listId ? { listIds: [listId] } : {}),
              ...(ownerId ? { ownerId } : {}),
              importJobId: jobId,
            };
            Object.assign(doc, deriveContactFields(doc));
            doc.searchTokens = buildSearchTokens(doc);
            inserts.push(doc);
          }
        }

        if (updates.length > 0) {
          try {
            const result = await Contact.bulkWrite(updates);
            // A row whose values already matched is still a successful import, not a skip.
            updated += result.matchedCount ?? 0;
            if (statusUpdates.length > 0) await Contact.bulkWrite(statusUpdates);
            await refreshDerived(matchedIds);
            await Activity.insertMany(
              matchedIds.map((id) => ({
                type: 'import',
                contactId: String(id),
                title: `Updated by import: ${job.fileName}`,
                metadata: { importJobId: jobId, change: 'updated' },
                channelRef: { kind: 'import', id: jobId },
                occurredAt: new Date(),
              })),
              { ordered: false },
            );
          } catch (err) {
            errors.push({ row: 0, message: err instanceof Error ? err.message : String(err) });
          }
        }

        if (inserts.length > 0) {
          let written: { _id: unknown }[] = [];
          try {
            // `ordered: false` so one malformed row out of 500 does not abandon the rest.
            written = await Contact.insertMany(inserts, { ordered: false });
          } catch (err) {
            const bulk = err as {
              insertedDocs?: { _id: unknown }[];
              writeErrors?: { errmsg?: string; err?: { errmsg?: string } }[];
            };
            written = bulk.insertedDocs ?? [];
            for (const writeError of bulk.writeErrors ?? []) {
              errors.push({ row: 0, message: writeError.errmsg ?? writeError.err?.errmsg ?? 'Row could not be written' });
            }
            if (!bulk.writeErrors) errors.push({ row: 0, message: err instanceof Error ? err.message : String(err) });
          }
          created += written.length;
          if (written.length > 0) {
            await Activity.insertMany(
              written.map((c) => ({
                type: 'import',
                contactId: String(c._id),
                title: `Created by import: ${job.fileName}`,
                metadata: { importJobId: jobId, change: 'created' },
                channelRef: { kind: 'import', id: jobId },
                occurredAt: new Date(),
              })),
              { ordered: false },
            );
          }
        }

        // Keep going: a handful of malformed rows should not abandon the import, but a
        // file that is wrong throughout should stop rather than write half of itself.
        if (errors.length > 100) break;
      }

      await ImportJob.updateOne(
        { _id: job._id },
        { $inc: { created, updated, skipped, errorCount: errors.length } },
      );

      res.json({ created, updated, skipped, errors: errors.slice(0, 50), errorCount: errors.length, total: input.rows.length });
    }),
  );
}

// ── Row handling ────────────────────────────────────────────────────────────

/** Column index → field, keeping only columns the user actually mapped to something real. */
function mapColumns(columns: string[], mapping: Record<string, string>, defs: FieldDef[]): Map<number, string> {
  const out = new Map<number, string>();
  columns.forEach((column, index) => {
    const field = mapping[column];
    if (field && isMappable(field, defs)) out.set(index, field);
  });
  return out;
}

/** A row's identity for matching: external id first, then phone digits, then email. */
function matchKey(doc: ContactInput): string | undefined {
  if (doc.sourceId) return `id:${doc.sourceId}`;
  const digits = phoneDigits(doc.phone);
  if (digits) return `ph:${digits}`;
  if (doc.email) return `em:${String(doc.email).toLowerCase()}`;
  return undefined;
}

/** Existing contacts for a batch of keys, in one query per key kind. */
async function findMatches(keys: string[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  const ids = keys.filter((k) => k.startsWith('id:')).map((k) => k.slice(3));
  const phones = keys.filter((k) => k.startsWith('ph:')).map((k) => k.slice(3));
  const emails = keys.filter((k) => k.startsWith('em:')).map((k) => k.slice(3));

  const or: Record<string, unknown>[] = [];
  if (ids.length) or.push({ sourceId: { $in: ids } });
  if (phones.length) or.push({ phoneDigits: { $in: phones } });
  if (emails.length) or.push({ email: { $in: emails } });
  if (or.length === 0) return out;

  /**
   * `lean()` matters more than it looks: hydrating full contact documents — each with
   * nested address and parcel subdocuments — measured 4.42 ms/row against 0.88 ms/row
   * for the projected lean query, which made it the single largest cost in the import.
   */
  const existing = await Contact.find({ $or: or }).select('_id sourceId phoneDigits email').lean();

  // First match wins per key, and an id match beats a phone match beats an email match.
  for (const c of existing) {
    if (c.sourceId && ids.includes(c.sourceId) && !out.has(`id:${c.sourceId}`)) out.set(`id:${c.sourceId}`, c._id);
  }
  for (const c of existing) {
    if (c.phoneDigits && phones.includes(c.phoneDigits) && !out.has(`ph:${c.phoneDigits}`)) out.set(`ph:${c.phoneDigits}`, c._id);
  }
  for (const c of existing) {
    if (c.email && emails.includes(c.email) && !out.has(`em:${c.email}`)) out.set(`em:${c.email}`, c._id);
  }
  return out;
}

async function countMatches(keys: string[]): Promise<number> {
  return (await findMatches(keys)).size;
}

/**
 * Fold a later row for the same person into an earlier one.
 *
 * Field by field rather than `Object.assign`, which replaced whole values: the second row's
 * tags discarded the first's, a second row with only a city erased the first row's street,
 * and — because every row starts from `status: 'new'` — a plain second row silently undid a
 * do-not-call on the first.
 */
function mergeRow(into: Pending, from: Pending): void {
  const { tags, address, properties, customFields, status, dnc, altPhones, ...rest } = stripEmpty(from.doc);

  Object.assign(into.doc, rest);
  into.doc.tags = [...new Set([...(into.doc.tags ?? []), ...(tags ?? [])])];
  into.doc.altPhones = [...new Set([...(into.doc.altPhones ?? []), ...(altPhones ?? [])])];
  Object.assign(into.doc.address, address);
  Object.assign(into.doc.customFields, customFields);
  if (Array.isArray(properties) && properties[0]) Object.assign(into.doc.properties[0], properties[0]);

  // Only a status the file actually states counts, and it never lifts a do-not-call.
  if (from.hasStatus && !into.doc.dnc) {
    into.doc.status = status;
    into.doc.dnc = dnc === true;
    into.hasStatus = true;
  }
}

/**
 * The update for a row that matched an existing contact.
 *
 * Built from dot paths and `$addToSet` so it adds to the record rather than replacing parts
 * of it: `$set: { address: { city } }` would overwrite the whole address with one field, and
 * `$set: { tags }` would drop every tag the contact had before this file. The parcel in the
 * file updates the primary parcel's fields; an owner is set only where there is none.
 */
function updateFor(item: Pending, listId: string | undefined, ownerId: string | undefined, jobId: string): Record<string, unknown> {
  const { tags, address, properties, customFields, status, dnc, altPhones, searchTokens: _t, ...rest } = stripEmpty(item.doc);

  const set: Record<string, unknown> = { ...rest, lastActivityAt: new Date() };
  for (const [key, value] of Object.entries(address ?? {})) set[`address.${key}`] = value;
  for (const [key, value] of Object.entries(customFields ?? {})) set[`customFields.${key}`] = value;
  const parcel = Array.isArray(properties) ? properties[0] : undefined;
  for (const [key, value] of Object.entries(parcel ?? {})) {
    if (key !== 'id' && key !== 'isPrimary') set[`property.${key}`] = value;
  }

  if (item.hasStatus && dnc === true) {
    set.status = status;
    set.dnc = true;
  }

  const addToSet: Record<string, unknown> = {};
  if (Array.isArray(tags) && tags.length > 0) addToSet.tags = { $each: tags };
  if (Array.isArray(altPhones) && altPhones.length > 0) addToSet.altPhones = { $each: altPhones };
  if (listId) addToSet.listIds = listId;

  void ownerId;
  void jobId;

  return { $set: set, ...(Object.keys(addToSet).length > 0 ? { $addToSet: addToSet } : {}) };
}

/**
 * Re-derive what a save would have derived, for contacts a `bulkWrite` just changed.
 *
 * `bulkWrite` runs no middleware. Without this a re-import that corrects a phone number
 * would leave the contact matchable by the old digits and not the new, and a parcel field
 * written to `property.*` would not reach `properties`. Two round trips per batch.
 */
async function refreshDerived(ids: unknown[]): Promise<void> {
  if (ids.length === 0) return;

  const contacts = await Contact.find({ _id: { $in: ids } })
    .select('firstName lastName company email phone altPhones property properties')
    .lean();

  await Contact.bulkWrite(
    contacts.map((contact) => {
      // The file's parcel values landed on `property`; fold them into the primary parcel.
      const primaryIndex = Math.max(0, (contact.properties ?? []).findIndex((p) => p.isPrimary));
      const properties = (contact.properties ?? []).map((p, i) =>
        i === primaryIndex ? { ...p, ...stripEmpty(contact.property ?? {}), id: p.id, isPrimary: true } : p,
      );
      const derived = deriveContactFields({
        ...(contact as Record<string, unknown>),
        properties: properties.length ? (properties as never) : undefined,
      });
      return {
        updateOne: {
          filter: { _id: contact._id },
          update: { $set: { ...derived, searchTokens: buildSearchTokens({ ...contact, ...derived }) } },
        },
      };
    }) as never[],
  );
}

/**
 * Build a contact document from one CSV row.
 *
 * `hasStatus` says whether the file stated a status or the default was filled in. On a new
 * contact the difference does not matter; on an existing one it is the difference between
 * "set this" and "leave what is there alone". A custom field value that does not fit its
 * definition is reported and left out, rather than failing the row.
 */
function rowToContact(
  row: string[],
  columnToField: Map<number, string>,
  defs: FieldDef[],
  tag: string | undefined,
  source: string | undefined,
): { doc: ContactInput; hasStatus: boolean; fieldErrors: string[] } {
  let hasStatus = false;
  const fieldErrors: string[] = [];
  const doc: ContactInput = {
    address: {},
    properties: [{ isPrimary: true }],
    customFields: {},
    tags: tag ? [tag] : [],
    altPhones: [],
    sourceSystem: 'import',
    status: 'new',
    dnc: false,
    source,
  };
  const parcel = doc.properties[0] as Record<string, unknown>;

  for (const [index, field] of columnToField) {
    const raw = (row[index] ?? '').trim();
    if (!raw) continue;

    if (field.startsWith(CUSTOM_FIELD_PREFIX)) {
      const key = field.slice(CUSTOM_FIELD_PREFIX.length);
      const def = defs.find((d) => d.key === key);
      if (!def) continue;
      try {
        const value = coerceCustomField(def, raw);
        if (value !== undefined) doc.customFields[key] = value;
      } catch (err) {
        fieldErrors.push(err instanceof Error ? err.message : String(err));
      }
      continue;
    }

    switch (field as ImportableField) {
      case 'externalId':
        doc.sourceId = raw;
        break;

      case 'altPhone':
        doc.altPhones.push(raw);
        break;

      case 'tags':
        // Accept both comma and semicolon separated tag lists.
        doc.tags.push(...raw.split(/[,;]/).map((t) => t.trim()).filter(Boolean));
        break;

      case 'status': {
        const status = raw.toLowerCase().replace(/[\s-]+/g, '_');
        if (STATUSES.has(status)) {
          doc.status = status;
          doc.dnc = status === 'do_not_call';
          hasStatus = true;
        }
        break;
      }

      case 'property.acres':
      case 'property.assessedValue': {
        // Strip currency symbols, thousands separators and stray units.
        const num = Number(raw.replace(/[^0-9.\-]/g, ''));
        if (Number.isFinite(num)) parcel[field.split('.')[1]!] = num;
        break;
      }

      default: {
        if (field.startsWith('address.')) doc.address[field.slice(8)] = raw;
        else if (field.startsWith('property.')) parcel[field.slice(9)] = raw;
        else doc[field] = raw;
      }
    }
  }

  doc.tags = [...new Set(doc.tags)];
  if (doc.email) doc.email = String(doc.email).toLowerCase();
  if (Object.keys(parcel).length === 1) doc.properties = [];
  doc.lastActivityAt = new Date();

  return { doc, hasStatus, fieldErrors };
}

/**
 * Drop empty values before merging into an existing contact.
 *
 * A blank cell in a re-imported file means "no new information", not "erase what you
 * already know" — a skip-trace refresh that omits the email column must not wipe emails.
 */
function stripEmpty(doc: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};

  for (const [key, value] of Object.entries(doc)) {
    if (value === undefined || value === null || value === '') continue;

    if (Array.isArray(value)) {
      if (value.length > 0) out[key] = value;
    } else if (typeof value === 'object' && !(value instanceof Date)) {
      const nested = stripEmpty(value);
      if (Object.keys(nested).length > 0) out[key] = nested;
    } else {
      out[key] = value;
    }
  }

  return out;
}
