import type { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../core/auth/middleware';
import { badRequest, handler, notFound } from '../../core/errors';
import { Contact, Task } from '../../models';
import { recordActivity } from './history';
import { memberById } from './members';

/**
 * Tasks (CNT-35): a follow-up to do, usually about a contact, assigned to a person.
 *
 * Part of the contacts module rather than a module of its own (decision D6). Completing
 * one writes a `task` entry to the contact's history, so "called back on the 14th as
 * promised" is visible where the promise was made.
 */
const taskBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5_000).optional(),
  contactId: z.string().optional(),
  opportunityId: z.string().optional(),
  /** Defaults to the person creating it. */
  assigneeId: z.string().optional(),
  dueAt: z.coerce.date().optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
});

export function registerTaskRoutes(router: Router) {
  /**
   * Tasks, filtered. `assignee=me` is the My Tasks page; `contactId` is a contact's tab.
   * Open tasks come due-soonest first; done ones most recently completed first.
   */
  router.get(
    '/tasks',
    // Managing tasks includes seeing them; `implies` in the catalog is advice to the role
    // editor, not something the permission check expands.
    requirePermission('contacts:task:read', 'contacts:task:manage'),
    handler(async (req, res) => {
      const q = z
        .object({
          assignee: z.string().optional(),
          contactId: z.string().optional(),
          status: z.enum(['open', 'done', 'all']).default('open'),
          /** `overdue`, `today`, `week` — relative to now, in UTC; the UI shows local. */
          due: z.enum(['overdue', 'today', 'week']).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(200),
        })
        .parse(req.query);

      const filter: Record<string, unknown> = {};
      if (q.assignee === 'me') filter.assigneeId = req.tenant!.userId;
      else if (q.assignee) filter.assigneeId = q.assignee;
      if (q.contactId) filter.contactId = q.contactId;
      if (q.status !== 'all') filter.status = q.status;

      const now = new Date();
      if (q.due === 'overdue') filter.dueAt = { $lt: now };
      if (q.due === 'today') {
        const end = new Date(now);
        end.setUTCHours(23, 59, 59, 999);
        filter.dueAt = { $lte: end };
      }
      if (q.due === 'week') filter.dueAt = { $lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) };

      const tasks = await Task.find(filter)
        .sort(q.status === 'done' ? { completedAt: -1 } : { dueAt: 1, priority: -1, createdAt: 1 })
        .limit(q.limit);

      // The contacts the tasks are about, so the list can show a name without a click.
      const contactIds = [...new Set(tasks.map((t) => t.contactId).filter((id): id is string => Boolean(id)))];
      const contacts = contactIds.length
        ? await Contact.find({ _id: { $in: contactIds } }).select('firstName lastName phone').lean()
        : [];
      const contactById = new Map(contacts.map((c) => [String(c._id), c]));

      res.json({
        data: tasks.map((t) => ({
          ...t.toJSON(),
          contact: t.contactId && contactById.has(t.contactId)
            ? {
                id: t.contactId,
                name: `${contactById.get(t.contactId)!.firstName} ${contactById.get(t.contactId)!.lastName}`.trim(),
                phone: contactById.get(t.contactId)!.phone,
              }
            : null,
        })),
      });
    }),
  );

  router.post(
    '/tasks',
    requirePermission('contacts:task:manage'),
    handler(async (req, res) => {
      const input = taskBody.parse(req.body);
      const ctx = req.tenant!;

      if (input.contactId && !(await Contact.exists({ _id: input.contactId }))) throw notFound('Contact');

      const assigneeId = input.assigneeId ?? ctx.userId;
      if (!(await memberById(ctx, assigneeId))) throw badRequest('That person is not a member of this sub-account');

      const task = await Task.create({ ...input, assigneeId, createdBy: ctx.userId, status: 'open' });

      if (input.contactId) {
        await recordActivity({
          type: 'task',
          contactId: input.contactId,
          userId: ctx.userId,
          title: `Task: ${input.title}`,
          body: input.dueAt ? `Due ${input.dueAt.toISOString().slice(0, 10)}` : undefined,
          metadata: { taskId: String(task._id), change: 'created' },
          channelRef: { kind: 'task', id: String(task._id) },
        });
      }

      res.status(201).json(task);
    }),
  );

  router.patch(
    '/tasks/:id',
    requirePermission('contacts:task:manage'),
    handler(async (req, res) => {
      const input = taskBody
        .partial()
        .extend({ status: z.enum(['open', 'done']).optional() })
        .parse(req.body);
      const ctx = req.tenant!;

      const task = await Task.findById(req.params.id);
      if (!task) throw notFound('Task');

      if (input.assigneeId && !(await memberById(ctx, input.assigneeId))) {
        throw badRequest('That person is not a member of this sub-account');
      }

      const wasDone = task.status === 'done';
      Object.assign(task, input);

      if (input.status === 'done' && !wasDone) task.completedAt = new Date();
      if (input.status === 'open' && wasDone) task.completedAt = undefined;

      await task.save();

      if (task.contactId && input.status !== undefined && (input.status === 'done') !== wasDone) {
        await recordActivity({
          type: 'task',
          contactId: task.contactId,
          userId: ctx.userId,
          title: input.status === 'done' ? `Completed: ${task.title}` : `Reopened: ${task.title}`,
          metadata: { taskId: String(task._id), change: input.status === 'done' ? 'completed' : 'reopened' },
          channelRef: { kind: 'task', id: String(task._id) },
        });
      }

      res.json(task);
    }),
  );

  router.delete(
    '/tasks/:id',
    requirePermission('contacts:task:manage'),
    handler(async (req, res) => {
      const result = await Task.deleteOne({ _id: req.params.id });
      if (result.deletedCount === 0) throw notFound('Task');
      res.status(204).end();
    }),
  );
}
