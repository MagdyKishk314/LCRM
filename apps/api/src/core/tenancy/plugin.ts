import type { Schema } from 'mongoose';
import { getTenantContext, requireTenantContext } from './context';

/** Every query hook that can read or write documents. Missing one would open a hole. */
const READ_HOOKS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'count',
  'countDocuments',
  'distinct',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'replaceOne',
] as const;

/**
 * Mongoose plugin that makes cross-tenant access impossible by default.
 *
 * Applied to every tenant-scoped schema, it:
 *   1. adds `agencyId` / `accountId` to the schema with a leading compound index,
 *   2. injects the current tenant filter into every query,
 *   3. stamps the tenant onto every insert,
 *   4. throws when there is no tenant context at all.
 *
 * Mongo has no row-level security, so this is the isolation boundary. It is deliberately
 * opt-out (`.bypassTenantScope()`) rather than opt-in — a developer who forgets it gets a
 * scoped query, not a leak.
 */
export function tenantScope(schema: Schema, options: { accountScoped?: boolean } = {}) {
  const accountScoped = options.accountScoped ?? true;

  schema.add({
    agencyId: { type: String, required: true, index: true },
    ...(accountScoped ? { accountId: { type: String, required: true, index: true } } : {}),
  });

  // Tenant discriminators lead every compound index so scoped reads use them.
  if (accountScoped) {
    schema.index({ agencyId: 1, accountId: 1, createdAt: -1 });
  } else {
    schema.index({ agencyId: 1, createdAt: -1 });
  }

  for (const hook of READ_HOOKS) {
    // Mongoose types `pre` as a set of overloads per hook name; a loop over a union
    // of literals matches none of them, so the middleware signature is asserted here.
    (schema.pre as any)(hook, function (this: any, next: (err?: Error) => void) {
      // `.bypassTenantScope()` sets this option; see the query helper below.
      if (this.getOptions?.().bypassTenantScope) return next();

      const ctx = getTenantContext();
      if (!ctx) {
        return next(
          new Error(
            `Tenant-scoped query (${hook}) ran without a tenant context. ` +
              'This is a bug — every request must establish context before touching the database.',
          ),
        );
      }
      if (ctx.bypassTenantScope) return next();

      const filter: Record<string, string> = { agencyId: ctx.agencyId };

      // An agency- or platform-scoped request legitimately reads across the accounts
      // beneath it, so accountId is only pinned when the request is inside one account.
      if (accountScoped && ctx.accountId) filter.accountId = ctx.accountId;

      this.where(filter);
      next();
    });
  }

  // Stamp the tenant on insert so callers cannot forget — or forge — it.
  //
  // `validate`, not `save`: Mongoose registers its own validation as a pre-save hook
  // when the schema is created, so any pre-save hook added later runs *after*
  // validation and the required agencyId/accountId would already have failed.
  schema.pre('validate', function (this: any, next: (err?: Error) => void) {
    if (this.$locals?.bypassTenantScope) return next();

    const ctx = getTenantContext();
    if (!ctx) {
      return next(new Error('Tenant-scoped document saved without a tenant context.'));
    }
    if (ctx.bypassTenantScope) return next();

    this.agencyId = ctx.agencyId;
    if (accountScoped) {
      if (!ctx.accountId) {
        return next(
          new Error('Cannot create an account-scoped document from an agency-scoped request.'),
        );
      }
      this.accountId = ctx.accountId;
    }
    next();
  });

  schema.pre('insertMany', function (next: (err?: Error) => void, docs: any[]) {
    const ctx = requireTenantContext();
    if (ctx.bypassTenantScope) return next();

    if (accountScoped && !ctx.accountId) {
      return next(
        new Error('Cannot bulk-insert account-scoped documents from an agency-scoped request.'),
      );
    }

    for (const doc of docs) {
      doc.agencyId = ctx.agencyId;
      if (accountScoped) doc.accountId = ctx.accountId;
    }
    next();
  });

  /**
   * `bulkWrite` carries its own filters and documents, so it is rewritten rather than hooked.
   *
   * None of the query hooks above see it: each operation in the array has its own filter,
   * and inserted documents skip document validation entirely. Left alone it would send
   * untenanted filters and write rows with no agencyId at all — the one call that could
   * quietly cross the isolation boundary.
   *
   * It exists because a CSV import updating 100,000 existing contacts one round trip at a
   * time cannot finish: at Atlas latency that is hours. Batched, it is one round trip per
   * few thousand rows.
   *
   * Upserts are safe once the filter is tenanted: MongoDB seeds an upserted document from
   * the filter's equality fields, so agencyId and accountId come along.
   */
  schema.pre('bulkWrite' as any, function (this: any, next: (err?: Error) => void, ops: any[]) {
    const ctx = getTenantContext();
    if (!ctx) {
      return next(
        new Error(
          'Tenant-scoped bulkWrite ran without a tenant context. ' +
            'This is a bug — every request must establish context before touching the database.',
        ),
      );
    }
    if (ctx.bypassTenantScope) return next();

    if (accountScoped && !ctx.accountId) {
      return next(
        new Error('Cannot bulk-write account-scoped documents from an agency-scoped request.'),
      );
    }

    const stamp = (target: Record<string, unknown>) => {
      target.agencyId = ctx.agencyId;
      if (accountScoped) target.accountId = ctx.accountId;
    };

    for (const op of ops ?? []) {
      if (op.insertOne?.document) {
        stamp(op.insertOne.document);
        continue;
      }
      const write = op.updateOne ?? op.updateMany ?? op.replaceOne ?? op.deleteOne ?? op.deleteMany;
      if (!write) {
        return next(new Error(`Unsupported bulkWrite operation: ${Object.keys(op).join(', ')}`));
      }
      write.filter = { ...(write.filter ?? {}) };
      stamp(write.filter);

      // A replacement document replaces the whole row, tenant fields included.
      if (op.replaceOne?.replacement) stamp(op.replaceOne.replacement);
    }

    next();
  });

  /**
   * Aggregations are scoped by prepending a `$match`.
   *
   * None of the query hooks see an aggregation — it is a pipeline, not a filter — so without
   * this the first `Model.aggregate()` on a tenant-scoped collection would read every
   * tenant's rows. Prepending rather than appending matters twice over: it is what lets the
   * tenant index serve the pipeline, and a `$match` placed after a `$group` would filter
   * totals that had already been summed across tenants.
   *
   * A pipeline whose first stage must stay first (`$geoNear`, `$search`) cannot be scoped
   * this way and will fail loudly, which is the right outcome until someone handles it
   * deliberately.
   */
  schema.pre('aggregate', function (this: any, next: (err?: Error) => void) {
    const ctx = getTenantContext();
    if (!ctx) {
      return next(
        new Error(
          'Tenant-scoped aggregation ran without a tenant context. ' +
            'This is a bug — every request must establish context before touching the database.',
        ),
      );
    }
    if (ctx.bypassTenantScope) return next();

    const match: Record<string, string> = { agencyId: ctx.agencyId };
    if (accountScoped && ctx.accountId) match.accountId = ctx.accountId;

    this.pipeline().unshift({ $match: match });
    next();
  });

  /** Opt out of scoping for this one query. Platform tooling only. */
  (schema.query as Record<string, unknown>).bypassTenantScope = function (this: any) {
    return this.setOptions({ bypassTenantScope: true });
  };
}

/**
 * Development-only assertion that documents leaving a handler belong to the caller.
 *
 * The plugin should make this impossible; this catches the case where an aggregation
 * or a raw driver call sidestepped it. Off in production because it costs a pass over
 * every response.
 */
export function assertTenantMatch(docs: unknown, label: string) {
  if (process.env.NODE_ENV === 'production') return;

  const ctx = getTenantContext();
  if (!ctx || ctx.bypassTenantScope) return;

  const list = Array.isArray(docs) ? docs : [docs];
  for (const doc of list) {
    if (!doc || typeof doc !== 'object') continue;
    const d = doc as { agencyId?: string; accountId?: string };
    if (d.agencyId && d.agencyId !== ctx.agencyId) {
      throw new Error(`Tenant leak in ${label}: agencyId ${d.agencyId} != ${ctx.agencyId}`);
    }
    if (ctx.accountId && d.accountId && d.accountId !== ctx.accountId) {
      throw new Error(`Tenant leak in ${label}: accountId ${d.accountId} != ${ctx.accountId}`);
    }
  }
}
