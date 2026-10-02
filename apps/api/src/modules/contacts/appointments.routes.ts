import type { Router } from 'express';
import { z } from 'zod';
import { APPOINTMENT_OUTCOMES } from '@landcaller/shared';
import { requirePermission } from '../../core/auth/middleware';
import { badRequest, handler, notFound } from '../../core/errors';
import { Appointment, Contact } from '../../models';
import { recordActivity } from './history';
import { memberById } from './members';

/**
 * Appointments (CNT-36): a time agreed with a contact, held by one team member.
 *
 * Entered by hand for now; the calendars module will sync these later and nothing here
 * changes (decision D3). Scheduling, rescheduling and recording the outcome each write an
 * `appointment` entry to the contact's history.
 */
const appointmentBody = z
  .object({
    contactId: z.string(),
    /** Defaults to the person scheduling it. */
    userId: z.string().optional(),
    title: z.string().min(1).max(200),
    startsAt: z.coerce.date(),
    /** Defaults to thirty minutes after the start. */
    endsAt: z.coerce.date().optional(),
    location: z.string().max(300).optional(),
    notes: z.string().max(5_000).optional(),
  })
  .refine((v) => !v.endsAt || v.endsAt > v.startsAt, { message: 'An appointment must end after it starts' });

const THIRTY_MINUTES = 30 * 60 * 1000;

export function registerAppointmentRoutes(router: Router) {
  /** `contactId` for a contact's tab; otherwise the Upcoming page (`when=upcoming`, the default). */
  router.get(
    '/appointments',
    // Managing appointments includes seeing them; `implies` is advice to the role editor only.
    requirePermission('contacts:appointment:read', 'contacts:appointment:manage'),
    handler(async (req, res) => {
      const q = z
        .object({
          contactId: z.string().optional(),
          user: z.string().optional(),
          when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
          limit: z.coerce.number().int().min(1).max(500).default(200),
        })
        .parse(req.query);

      const filter: Record<string, unknown> = {};
      if (q.contactId) filter.contactId = q.contactId;
      if (q.user === 'me') filter.userId = req.tenant!.userId;
      else if (q.user) filter.userId = q.user;
      if (q.when === 'upcoming') filter.endsAt = { $gte: new Date() };
      if (q.when === 'past') filter.endsAt = { $lt: new Date() };

      const appointments = await Appointment.find(filter)
        .sort({ startsAt: q.when === 'past' ? -1 : 1 })
        .limit(q.limit);

      const contactIds = [...new Set(appointments.map((a) => a.contactId))];
      const contacts = contactIds.length
        ? await Contact.find({ _id: { $in: contactIds } }).select('firstName lastName phone').lean()
        : [];
      const contactById = new Map(contacts.map((c) => [String(c._id), c]));

      res.json({
        data: appointments.map((a) => ({
          ...a.toJSON(),
          contact: contactById.has(a.contactId)
            ? {
                id: a.contactId,
                name: `${contactById.get(a.contactId)!.firstName} ${contactById.get(a.contactId)!.lastName}`.trim(),
                phone: contactById.get(a.contactId)!.phone,
              }
            : null,
        })),
      });
    }),
  );

  router.post(
    '/appointments',
    requirePermission('contacts:appointment:manage'),
    handler(async (req, res) => {
      const input = appointmentBody.parse(req.body);
      const ctx = req.tenant!;

      if (!(await Contact.exists({ _id: input.contactId }))) throw notFound('Contact');

      const userId = input.userId ?? ctx.userId;
      if (!(await memberById(ctx, userId))) throw badRequest('That person is not a member of this sub-account');

      const appointment = await Appointment.create({
        ...input,
        userId,
        endsAt: input.endsAt ?? new Date(input.startsAt.getTime() + THIRTY_MINUTES),
        outcome: 'scheduled',
      });

      await recordActivity({
        type: 'appointment',
        contactId: input.contactId,
        userId: ctx.userId,
        title: `Scheduled: ${input.title}`,
        body: input.location ? `At ${input.location}` : undefined,
        metadata: {
          appointmentId: String(appointment._id),
          startsAt: appointment.startsAt.toISOString(),
          change: 'scheduled',
        },
        channelRef: { kind: 'appointment', id: String(appointment._id) },
        occurredAt: new Date(),
      });

      res.status(201).json(appointment);
    }),
  );

  router.patch(
    '/appointments/:id',
    requirePermission('contacts:appointment:manage'),
    handler(async (req, res) => {
      const input = z
        .object({
          userId: z.string().optional(),
          title: z.string().min(1).max(200).optional(),
          startsAt: z.coerce.date().optional(),
          endsAt: z.coerce.date().optional(),
          location: z.string().max(300).optional(),
          notes: z.string().max(5_000).optional(),
          outcome: z.enum(APPOINTMENT_OUTCOMES).optional(),
        })
        .parse(req.body);
      const ctx = req.tenant!;

      const appointment = await Appointment.findById(req.params.id);
      if (!appointment) throw notFound('Appointment');

      if (input.userId && !(await memberById(ctx, input.userId))) {
        throw badRequest('That person is not a member of this sub-account');
      }

      const before = { startsAt: appointment.startsAt.getTime(), outcome: appointment.outcome };
      Object.assign(appointment, input);
      if (input.startsAt && !input.endsAt) {
        // Keep the duration when only the start moves.
        const duration = before.startsAt ? appointment.endsAt.getTime() - before.startsAt : THIRTY_MINUTES;
        appointment.endsAt = new Date(input.startsAt.getTime() + Math.max(duration, 5 * 60 * 1000));
      }
      if (appointment.endsAt <= appointment.startsAt) throw badRequest('An appointment must end after it starts');

      await appointment.save();

      const moved = appointment.startsAt.getTime() !== before.startsAt;
      const resolved = input.outcome && input.outcome !== before.outcome;
      if (moved || resolved) {
        await recordActivity({
          type: 'appointment',
          contactId: appointment.contactId,
          userId: ctx.userId,
          title: resolved
            ? `${OUTCOME_LABEL[appointment.outcome as keyof typeof OUTCOME_LABEL]}: ${appointment.title}`
            : `Rescheduled: ${appointment.title}`,
          metadata: {
            appointmentId: String(appointment._id),
            startsAt: appointment.startsAt.toISOString(),
            outcome: appointment.outcome,
            change: resolved ? 'outcome' : 'updated',
          },
          channelRef: { kind: 'appointment', id: String(appointment._id) },
        });
      }

      res.json(appointment);
    }),
  );

  router.delete(
    '/appointments/:id',
    requirePermission('contacts:appointment:manage'),
    handler(async (req, res) => {
      const result = await Appointment.deleteOne({ _id: req.params.id });
      if (result.deletedCount === 0) throw notFound('Appointment');
      res.status(204).end();
    }),
  );
}

const OUTCOME_LABEL = {
  scheduled: 'Scheduled',
  held: 'Held',
  no_show: 'No-show',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
} as const;
