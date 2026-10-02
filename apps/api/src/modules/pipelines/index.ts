import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../core/auth/middleware';
import { badRequest, conflict, handler, notFound } from '../../core/errors';
import type { ApiModule } from '../../core/registry';
import { Contact, Opportunity, Pipeline } from '../../models';
import { recordActivity } from '../contacts/history';

// Guarded by the registry: authenticate → resolveTenant → requireModule('pipelines').
const router = Router();

const stageSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(60),
  order: z.number().int().min(0),
  color: z.string().default('neutral'),
  probability: z.number().min(0).max(100).default(0),
});

router.get(
  '/',
  requirePermission('pipelines:pipeline:read', 'pipelines:opportunity:read'),
  handler(async (_req, res) => {
    const pipelines = await Pipeline.find().sort({ isDefault: -1, createdAt: 1 });
    res.json({ data: pipelines });
  }),
);

router.post(
  '/',
  requirePermission('pipelines:pipeline:manage'),
  handler(async (req, res) => {
    const input = z
      .object({
        name: z.string().min(1).max(120),
        stages: z.array(stageSchema).min(1),
        isDefault: z.boolean().default(false),
      })
      .parse(req.body);

    const pipeline = await Pipeline.create({
      ...input,
      // Stage ids are generated here so the board can reference them before the
      // client has ever seen the saved document.
      stages: input.stages.map((s) => ({ ...s, id: s.id ?? randomUUID() })),
    });

    res.status(201).json(pipeline);
  }),
);

/**
 * Rename a pipeline and edit its stages.
 *
 * Stage ids are preserved, never regenerated: every opportunity stores `stageId`, so
 * reissuing ids on save would strand every card in the pipeline. A stage arriving without
 * an id is new; one arriving with a known id is an edit; one that has vanished from the
 * submitted list is a delete — and a delete is refused while cards still sit in it.
 */
router.patch(
  '/:id',
  requirePermission('pipelines:pipeline:manage'),
  handler(async (req, res) => {
    const input = z
      .object({
        name: z.string().min(1).max(120).optional(),
        stages: z.array(stageSchema).min(1).optional(),
        isDefault: z.boolean().optional(),
      })
      .parse(req.body);

    const pipeline = await Pipeline.findById(req.params.id);
    if (!pipeline) throw notFound('Pipeline');

    if (input.name !== undefined) pipeline.name = input.name;

    if (input.stages) {
      const existingIds = new Set(pipeline.stages.map((s) => s.id));
      const submittedIds = new Set(input.stages.map((s) => s.id).filter(Boolean) as string[]);

      // Any stage the caller dropped must be empty first.
      const removed = [...existingIds].filter((id) => !submittedIds.has(id));
      if (removed.length > 0) {
        const stranded = await Opportunity.countDocuments({
          pipelineId: String(pipeline._id),
          stageId: { $in: removed },
        });
        if (stranded > 0) {
          const names = pipeline.stages
            .filter((s) => removed.includes(s.id))
            .map((s) => s.name)
            .join(', ');
          throw conflict(
            `${stranded} ${stranded === 1 ? 'opportunity is' : 'opportunities are'} still in ` +
              `${names}. Move them to another stage before removing it.`,
          );
        }
      }

      // An unknown id would silently orphan cards pointing at it, so only ids this
      // pipeline already owns are honoured; anything else is treated as a new stage.
      // `.set()` rather than direct assignment: `stages` is a Mongoose DocumentArray,
      // which does not accept a plain array.
      pipeline.set(
        "stages",
        input.stages.map((s, index) => ({
          id: s.id && existingIds.has(s.id) ? s.id : randomUUID(),
          name: s.name,
          order: index,
          color: s.color,
          probability: s.probability,
        })),
      );
    }

    // Exactly one default per sub-account, so the board always has somewhere to land.
    if (input.isDefault) {
      await Pipeline.updateMany({ _id: { $ne: pipeline._id } }, { $set: { isDefault: false } });
      pipeline.isDefault = true;
    }

    await pipeline.save();
    res.json(pipeline);
  }),
);

router.delete(
  '/:id',
  requirePermission('pipelines:pipeline:manage'),
  handler(async (req, res) => {
    const pipeline = await Pipeline.findById(req.params.id);
    if (!pipeline) throw notFound('Pipeline');

    // Cascading would destroy deal history to satisfy a tidy-up. Refuse and say what is
    // in the way instead.
    const held = await Opportunity.countDocuments({ pipelineId: String(pipeline._id) });
    if (held > 0) {
      throw conflict(
        `This pipeline still holds ${held} ${held === 1 ? 'opportunity' : 'opportunities'}. ` +
          'Move or delete them first.',
      );
    }

    const remaining = await Pipeline.countDocuments({ _id: { $ne: pipeline._id } });
    if (remaining === 0) {
      throw badRequest('This is the only pipeline. Create another before deleting this one.');
    }

    await Pipeline.deleteOne({ _id: pipeline._id });

    // Something must remain default, or the board lands nowhere.
    if (pipeline.isDefault) {
      const next = await Pipeline.findOne({}).sort({ createdAt: 1 });
      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }

    res.status(204).end();
  }),
);

/** One pipeline's open cards and the contacts they name, ready to group by stage. */
async function boardFor(pipelineId: string) {
  const opportunities = await Opportunity.find({ pipelineId }).sort({ order: 1 });

  // One extra query rather than N — the board renders a contact name per card.
  const contacts = await Contact.find({
    _id: { $in: opportunities.map((o) => o.contactId) },
  }).select('firstName lastName phone email');

  return { opportunities, contacts };
}

/**
 * The board page in one request: every pipeline, plus the board for the selected one.
 *
 * The page used to ask for the list and then, once it knew which pipeline to show, ask
 * for its board — two requests in a row, each paying for authentication and a membership
 * lookup before doing anything. `?pipeline=` picks one; an unknown id, or none, falls back
 * to the default so a stale link still lands somewhere.
 */
router.get(
  '/board',
  requirePermission('pipelines:opportunity:read'),
  handler(async (req, res) => {
    const pipelines = await Pipeline.find().sort({ isDefault: -1, createdAt: 1 });
    if (pipelines.length === 0) {
      res.json({ pipelines, pipeline: null, opportunities: [], contacts: [] });
      return;
    }

    const requested = typeof req.query.pipeline === 'string' ? req.query.pipeline : undefined;
    const pipeline =
      pipelines.find((p) => String(p._id) === requested) ??
      pipelines.find((p) => p.isDefault) ??
      pipelines[0]!;

    res.json({ pipelines, pipeline, ...(await boardFor(String(pipeline._id))) });
  }),
);

/** The board: one pipeline plus its open opportunities, ready to group by stage. */
router.get(
  '/:id/board',
  requirePermission('pipelines:opportunity:read'),
  handler(async (req, res) => {
    const pipeline = await Pipeline.findById(req.params.id);
    if (!pipeline) throw notFound('Pipeline');

    res.json({ pipeline, ...(await boardFor(String(pipeline._id))) });
  }),
);

const opportunityBodySchema = z.object({
  pipelineId: z.string(),
  stageId: z.string(),
  contactId: z.string(),
  name: z.string().min(1).max(200),
  value: z.number().nonnegative().default(0),
  currency: z.string().length(3).default('USD'),
  ownerId: z.string().optional(),
  expectedCloseDate: z.coerce.date().optional(),
  customFields: z.record(z.unknown()).optional(),
});

router.post(
  '/opportunities',
  requirePermission('pipelines:opportunity:create'),
  handler(async (req, res) => {
    const input = opportunityBodySchema.parse(req.body);

    const [pipeline, contact] = await Promise.all([
      Pipeline.findById(input.pipelineId),
      Contact.findById(input.contactId),
    ]);
    if (!pipeline) throw notFound('Pipeline');
    if (!contact) throw notFound('Contact');
    if (!pipeline.stages.some((s) => s.id === input.stageId)) {
      throw badRequest('That stage does not belong to this pipeline');
    }

    // New cards land at the bottom of their column.
    const last = await Opportunity.findOne({
      pipelineId: input.pipelineId,
      stageId: input.stageId,
    }).sort({ order: -1 });

    const opportunity = await Opportunity.create({
      ...input,
      order: (last?.order ?? -1) + 1,
    });

    await recordActivity({
      type: 'created',
      contactId: input.contactId,
      opportunityId: String(opportunity._id),
      userId: req.tenant!.userId,
      title: `Opportunity created: ${input.name}`,
      channelRef: { kind: 'opportunity', id: String(opportunity._id) },
    });

    res.status(201).json(opportunity);
  }),
);

const moveSchema = z.object({
  stageId: z.string(),
  order: z.number().int().min(0).optional(),
});

/**
 * Move a card between stages — the drag-and-drop endpoint.
 *
 * Writes a `stage_change` activity so the contact timeline shows deal progress
 * alongside calls and emails.
 */
router.patch(
  '/opportunities/:id/move',
  requirePermission('pipelines:opportunity:update'),
  handler(async (req, res) => {
    const input = moveSchema.parse(req.body);

    const opportunity = await Opportunity.findById(req.params.id);
    if (!opportunity) throw notFound('Opportunity');

    const pipeline = await Pipeline.findById(opportunity.pipelineId);
    if (!pipeline) throw notFound('Pipeline');

    const from = pipeline.stages.find((s) => s.id === opportunity.stageId);
    const to = pipeline.stages.find((s) => s.id === input.stageId);
    if (!to) throw badRequest('That stage does not belong to this pipeline');

    if (opportunity.stageId !== input.stageId) {
      await recordActivity({
        type: 'stage_change',
        contactId: opportunity.contactId,
        opportunityId: String(opportunity._id),
        userId: req.tenant!.userId,
        title: `Moved to ${to.name}`,
        metadata: { from: from?.name, to: to.name },
        channelRef: { kind: 'opportunity', id: String(opportunity._id) },
      });
    }

    opportunity.stageId = input.stageId;
    if (input.order !== undefined) opportunity.order = input.order;

    // A card dropped in the final stage is won — the board has no separate "close" action.
    // And one dragged back out is open again: leaving it `won` kept it off the dashboard's
    // open pipeline while it sat, visibly, in the middle of the board.
    const lastStage = [...pipeline.stages].sort((a, b) => b.order - a.order)[0];
    if (lastStage && to.id === lastStage.id) opportunity.status = 'won';
    else if (opportunity.status === 'won') opportunity.status = 'open';

    await opportunity.save();
    res.json(opportunity);
  }),
);

router.patch(
  '/opportunities/:id',
  requirePermission('pipelines:opportunity:update'),
  handler(async (req, res) => {
    /**
     * Pipeline and stage are not editable here.
     *
     * Create checks that the stage belongs to the pipeline, and `/move` checks it again and
     * writes the timeline entry. Accepting either field on a plain edit skipped both, so a
     * card could be pointed at a stage that does not exist and vanish from every column.
     */
    const input = opportunityBodySchema
      .omit({ pipelineId: true, stageId: true })
      .partial()
      // Strict, so a caller sending `stageId` is told it was refused rather than having it
      // silently dropped and wondering why the card did not move.
      .strict()
      .parse(req.body);

    const opportunity = await Opportunity.findById(req.params.id);
    if (!opportunity) throw notFound('Opportunity');

    // Re-pointing a card must land on a contact in this sub-account, as creating one does.
    if (input.contactId !== undefined && input.contactId !== opportunity.contactId) {
      const contact = await Contact.findById(input.contactId).select('_id');
      if (!contact) throw notFound('Contact');
    }

    Object.assign(opportunity, input);
    await opportunity.save();

    res.json(opportunity);
  }),
);

router.delete(
  '/opportunities/:id',
  requirePermission('pipelines:opportunity:delete'),
  handler(async (req, res) => {
    const result = await Opportunity.deleteOne({ _id: req.params.id });
    if (result.deletedCount === 0) throw notFound('Opportunity');
    res.status(204).end();
  }),
);

export const pipelinesModule: ApiModule = { key: 'pipelines', router };
