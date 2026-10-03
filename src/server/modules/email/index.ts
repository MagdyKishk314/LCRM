import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../core/auth/middleware';
import { badRequest, handler, notFound } from '../../core/errors';
import { paginate, paginationSchema, parseSort } from '../../core/pagination';
import type { ApiModule } from '../../core/registry';
import { Account, Contact, EmailIdentity, EmailMessage, EmailTemplate, User } from '../../models';
import { recordActivity } from '../contacts/history';
import { env } from '../../config/env';
import { generateInvite, INVITE_TTL_DAYS } from '../../core/auth/invites';
import { DO_NOT_CONTACT_QUERY, isDoNotContact } from '../contacts/dnc';
import { extractMergeFields, renderTemplate, textToHtml } from './merge';
import { sendMail, smtpConfigured } from './transport';

// Guarded by the registry: authenticate → resolveTenant → requireModule('email').
const router = Router();

// ── Messages ────────────────────────────────────────────────────────────────

router.get(
  '/messages',
  requirePermission('email:message:read'),
  handler(async (req, res) => {
    const q = paginationSchema.extend({ contactId: z.string().optional() }).parse(req.query);

    const filter = q.contactId ? { contactId: q.contactId } : {};

    const [data, total] = await Promise.all([
      EmailMessage.find(filter)
        .sort(parseSort(q.sort, { createdAt: -1 }))
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize),
      EmailMessage.countDocuments(filter),
    ]);

    res.json(paginate(data, total, q));
  }),
);

const sendSchema = z
  .object({
    contactId: z.string().optional(),
    to: z.array(z.string().email()).min(1).max(50),
    cc: z.array(z.string().email()).max(20).optional(),
    /** Optional when a template supplies them; anything sent here wins over the template. */
    subject: z.string().min(1).max(300).optional(),
    body: z.string().min(1).max(200_000).optional(),
    templateId: z.string().optional(),
    identityId: z.string().optional(),
  })
  .refine((v) => Boolean(v.templateId) || (Boolean(v.subject) && Boolean(v.body)), {
    message: 'Provide a subject and body, or choose a template',
  });

router.post(
  '/messages',
  requirePermission('email:message:send'),
  handler(async (req, res) => {
    const input = sendSchema.parse(req.body);
    const ctx = req.tenant!;

    const identity = input.identityId
      ? await EmailIdentity.findById(input.identityId)
      : await EmailIdentity.findOne({ isDefault: true });

    if (!identity) {
      throw badRequest('No sending identity configured for this sub-account');
    }
    if (!identity.verified) {
      throw badRequest(
        `${identity.fromEmail} is not verified yet. Verify the domain before sending.`,
      );
    }

    // A template fills in whatever the request left out. It used to be accepted and
    // ignored, so "send this template" sent nothing of the sort.
    const template = input.templateId ? await EmailTemplate.findById(input.templateId) : null;
    if (input.templateId && !template) throw notFound('Template');

    let subject = input.subject ?? template?.subject ?? '';
    let body = input.body ?? template?.body ?? '';

    /**
     * Nobody marked do-not-contact is emailed — by any route.
     *
     * The check used to look only at the contact named in the request, and only refused
     * when the flag *and* the status both said so. It now reads every address on the
     * message against this sub-account's contacts, and either signal is enough: `to` is
     * free text, so the named contact is not necessarily who the mail is going to.
     */
    const recipients = [...input.to, ...(input.cc ?? [])].map((a) => a.toLowerCase());
    const blocked = await Contact.find({
      $and: [{ email: { $in: recipients } }, DO_NOT_CONTACT_QUERY],
    })
      .select('email')
      .lean();
    if (blocked.length > 0) {
      const who = [...new Set(blocked.map((c) => c.email))].join(', ');
      throw badRequest(`Marked do-not-contact and cannot be emailed: ${who}`);
    }

    // Merge fields are resolved server-side so the rendered copy stored on the timeline
    // is exactly what the recipient received.
    if (input.contactId) {
      const [contact, user, account] = await Promise.all([
        Contact.findById(input.contactId),
        User.findById(ctx.userId),
        Account.findById(ctx.accountId),
      ]);
      if (!contact) throw notFound('Contact');

      if (isDoNotContact(contact)) {
        throw badRequest('This contact is marked do-not-contact');
      }

      const mergeContext = {
        contact: contact.toJSON(),
        user: user?.toJSON(),
        account: account?.toJSON(),
      };
      subject = renderTemplate(subject, mergeContext);
      body = renderTemplate(body, mergeContext);
    }

    const message = await EmailMessage.create({
      contactId: input.contactId,
      identityId: String(identity._id),
      direction: 'outbound',
      to: input.to,
      cc: input.cc,
      subject,
      body,
      status: 'queued',
    });

    try {
      await sendMail({
        from: `${identity.fromName} <${identity.fromEmail}>`,
        replyTo: identity.replyTo ?? undefined,
        to: input.to,
        cc: input.cc,
        subject,
        text: body,
        html: textToHtml(body),
      });

      message.status = 'sent';
      message.sentAt = new Date();
      await message.save();
    } catch (err) {
      // The message row is kept in a failed state rather than deleted, so a send
      // failure is visible on the contact timeline instead of vanishing.
      message.status = 'failed';
      message.error = err instanceof Error ? err.message : String(err);
      await message.save();
      throw badRequest(`Email could not be sent: ${message.error}`);
    }

    if (input.contactId) {
      // Through the history contract, so the Emails tab can open the message.
      await recordActivity({
        type: 'email',
        contactId: input.contactId,
        userId: ctx.userId,
        title: `Sent: ${subject}`,
        body,
        metadata: { messageId: String(message._id), direction: 'outbound' },
        channelRef: { kind: 'email', id: String(message._id) },
      });
    }

    res.status(201).json(message);
  }),
);

// ── Templates ───────────────────────────────────────────────────────────────

router.get(
  '/templates',
  requirePermission('email:template:read'),
  handler(async (_req, res) => {
    const templates = await EmailTemplate.find().sort({ name: 1 });
    res.json({ data: templates });
  }),
);

const templateSchema = z.object({
  name: z.string().min(1).max(120),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(200_000),
  category: z.string().max(60).optional(),
});

router.post(
  '/templates',
  requirePermission('email:template:manage'),
  handler(async (req, res) => {
    const input = templateSchema.parse(req.body);

    const template = await EmailTemplate.create({
      ...input,
      // Derived rather than accepted from the client, so the chips shown in the editor
      // always match what the body actually references.
      mergeFields: extractMergeFields(input.subject, input.body),
    });

    res.status(201).json(template);
  }),
);

router.patch(
  '/templates/:id',
  requirePermission('email:template:manage'),
  handler(async (req, res) => {
    const input = templateSchema.partial().parse(req.body);

    const template = await EmailTemplate.findById(req.params.id);
    if (!template) throw notFound('Template');

    Object.assign(template, input);
    template.mergeFields = extractMergeFields(template.subject, template.body);
    await template.save();

    res.json(template);
  }),
);

router.delete(
  '/templates/:id',
  requirePermission('email:template:manage'),
  handler(async (req, res) => {
    const result = await EmailTemplate.deleteOne({ _id: req.params.id });
    if (result.deletedCount === 0) throw notFound('Template');
    res.status(204).end();
  }),
);

// ── Identities ──────────────────────────────────────────────────────────────

router.get(
  '/identities',
  requirePermission('email:message:read'),
  handler(async (_req, res) => {
    const identities = await EmailIdentity.find().sort({ isDefault: -1 });
    res.json({ data: identities });
  }),
);

router.post(
  '/identities',
  requirePermission('email:identity:manage'),
  handler(async (req, res) => {
    const input = z
      .object({
        fromName: z.string().min(1).max(120),
        fromEmail: z.string().email(),
        replyTo: z.string().email().optional(),
        isDefault: z.boolean().default(false),
      })
      .parse(req.body);

    // Exactly one default per sub-account, so an unspecified send is never ambiguous.
    if (input.isDefault) {
      await EmailIdentity.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    }

    const pending = generateInvite();
    const identity = await EmailIdentity.create({
      ...input,
      verified: false,
      verifyTokenHash: pending.hash,
      verifyExpiresAt: pending.expiresAt,
    });

    const verifyUrl = await sendVerification(identity, pending.token);
    res.status(201).json({ ...publicIdentity(identity), verifyUrl });
  }),
);

/**
 * Proving a sending address belongs to whoever added it.
 *
 * A sub-account could add any address as a sender, and nothing could ever mark it verified
 * — the send route refuses unverified identities, so the only one that worked was the one
 * the seed script created. Verification is a link mailed *to the address itself*: whoever
 * can open it controls the mailbox.
 *
 * This proves control of a mailbox, not authority to send for a domain. SPF and DKIM for
 * the domain are still the mail provider's and the DNS owner's to set up; if the provider
 * offers domain verification, that should replace this rather than sit beside it.
 *
 * Returns the link only when SMTP is not configured — the same arrangement invites use, so
 * a fresh install can complete the flow by hand. With SMTP on, the link travels by mail and
 * nowhere else; handing it to the person who typed the address would verify nothing.
 */
/** An identity as the API returns it — never with the hash of its pending token. */
function publicIdentity(identity: { toJSON(): Record<string, unknown> }) {
  const { verifyTokenHash: _hash, ...rest } = identity.toJSON();
  return rest;
}

async function sendVerification(
  identity: { fromName: string; fromEmail: string },
  token: string,
): Promise<string | null> {
  const url = `${env.APP_URL.replace(/\/+$/, '')}/verify-sender/${token}`;
  const text =
    `Someone asked to send email as "${identity.fromName}" <${identity.fromEmail}> ` +
    `from LandCaller CRM.\n\nIf that was you, confirm the address:\n${url}\n\n` +
    `The link works for ${INVITE_TTL_DAYS} days. If it was not you, ignore this message ` +
    'and nothing will be sent from this address.';

  await sendMail({
    from: env.EMAIL_FROM_DEFAULT,
    to: [identity.fromEmail],
    subject: 'Confirm this sending address',
    text,
    html: textToHtml(text),
  });

  return smtpConfigured() ? null : url;
}

router.post(
  '/identities/:id/resend',
  requirePermission('email:identity:manage'),
  handler(async (req, res) => {
    const identity = await EmailIdentity.findById(req.params.id);
    if (!identity) throw notFound('Sending identity');
    if (identity.verified) throw badRequest(`${identity.fromEmail} is already verified`);

    // A fresh token each time, so an earlier link that went astray stops working.
    const pending = generateInvite();
    identity.verifyTokenHash = pending.hash;
    identity.verifyExpiresAt = pending.expiresAt;
    await identity.save();

    const verifyUrl = await sendVerification(identity, pending.token);
    res.json({ ...publicIdentity(identity), verifyUrl });
  }),
);

router.post(
  '/identities/:id/default',
  requirePermission('email:identity:manage'),
  handler(async (req, res) => {
    const identity = await EmailIdentity.findById(req.params.id);
    if (!identity) throw notFound('Sending identity');

    await EmailIdentity.updateMany({ _id: { $ne: identity._id } }, { $set: { isDefault: false } });
    identity.isDefault = true;
    await identity.save();

    res.json(identity);
  }),
);

router.delete(
  '/identities/:id',
  requirePermission('email:identity:manage'),
  handler(async (req, res) => {
    const result = await EmailIdentity.deleteOne({ _id: req.params.id });
    if (result.deletedCount === 0) throw notFound('Sending identity');
    res.status(204).end();
  }),
);

export const emailModule: ApiModule = { key: 'email', router };
