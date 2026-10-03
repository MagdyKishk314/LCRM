import bcrypt from 'bcryptjs';
import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { ACTIVITY_TYPES, type ModuleKey } from '@/shared';
import { evict } from '../core/cache';
import { tenantScope } from '../core/tenancy/plugin';
import { deriveContactFields } from '../modules/contacts/derive';
import { buildSearchTokens } from '../modules/contacts/search';

const timestamps = { timestamps: true } as const;

/**
 * Keep `core/cache` honest for a model that is read through it.
 *
 * A saved document evicts its own entry. A query-style write does not say which documents
 * it touched, so it clears the whole kind — these are rare, administrative writes, and a
 * cold cache costs one round trip.
 */
function evictOnWrite(schema: Schema, kind: string) {
  schema.post('save', (doc: { _id: unknown }) => evict(kind, String(doc._id)));
  for (const hook of [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'findOneAndDelete',
    'deleteOne',
    'deleteMany',
  ] as const) {
    (schema.post as any)(hook, () => evict(kind));
  }
}

// ── Identity & tenancy (not tenant-scoped — these define the tenants) ────────

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    /**
     * Absent for a user who only signs in with a linked provider.
     *
     * Optional rather than required because a Google-only account genuinely has no
     * password — the invariant is not "has a password" but "has some way to sign in",
     * enforced below across this field and `identities`.
     */
    passwordHash: { type: String, select: false },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phone: String,
    avatarUrl: String,
    status: { type: String, enum: ['active', 'invited', 'suspended'], default: 'invited' },
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String, select: false },
    lastLoginAt: Date,
    /** Invalidates every issued refresh token when bumped (password change, forced logout). */
    tokenVersion: { type: Number, default: 0 },

    /**
     * One-time invite, so a new user can set their own password.
     *
     * Only the hash is stored — a leaked database should not hand out working setup
     * links — and it is cleared the moment the invite is accepted, making it single-use.
     */
    inviteTokenHash: { type: String, select: false },
    inviteExpiresAt: { type: Date },

    /**
     * External accounts that may sign in as this user.
     *
     * A subdocument array rather than its own collection: a person has a handful of these,
     * they are always wanted alongside the user, and keeping them here makes sign-in one
     * query. A separate collection earns its place once identities have an independent
     * lifecycle — SCIM provisioning, many providers — and moving them later touches only
     * `identities.ts`, because nothing else reads this field directly.
     */
    identities: [
      new Schema(
        {
          provider: { type: String, required: true, enum: ['google'] },
          /** The provider's stable id for this account. Never the email, which can change. */
          subject: { type: String, required: true },
          /** The address at link time, for display — not used to authenticate. */
          email: { type: String, lowercase: true, trim: true },
          linkedAt: { type: Date, default: Date.now },
        },
        { _id: false },
      ),
    ],
  },
  timestamps,
);

/**
 * One external account cannot be attached to two users.
 *
 * Without this, two CRM users could each claim the same Google account and which one you
 * landed in would depend on query order.
 */
userSchema.index(
  { 'identities.provider': 1, 'identities.subject': 1 },
  { unique: true, sparse: true },
);

/**
 * A user must keep at least one way to sign in.
 *
 * Invited users are exempt: they have neither yet, which is the whole point of an invite.
 */
userSchema.pre('validate', function (this: any, next: (err?: Error) => void) {
  const hasPassword = Boolean(this.passwordHash);
  const hasIdentity = Array.isArray(this.identities) && this.identities.length > 0;

  if (!hasPassword && !hasIdentity && this.status !== 'invited') {
    return next(
      new Error(
        'A user must have a password or a linked sign-in provider. Set a password before ' +
          'unlinking the last provider.',
      ),
    );
  }
  next();
});

userSchema.methods.verifyPassword = async function (plain: string): Promise<boolean> {
  /**
   * A provider-only user has no hash to compare against.
   *
   * Returning early would answer faster than a real comparison and leak which accounts
   * have passwords, so this hashes against a fixed dummy to keep the work constant — the
   * same reason login gives one message for "no such user" and "wrong password".
   */
  if (!this.passwordHash) {
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, this.passwordHash);
};

/**
 * A valid bcrypt hash of a value nobody knows, compared against when there is no real one.
 *
 * Generated once at module load so the cost matches a genuine comparison.
 */
const DUMMY_HASH = bcrypt.hashSync('no-password-set-for-this-account', 12);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

const planSchema = new Schema(
  {
    name: { type: String, required: true },
    modules: [{ type: String }],
    limits: {
      accounts: { type: Number, default: 10 },
      users: { type: Number, default: 50 },
      contacts: { type: Number, default: 100_000 },
    },
    pricePerMonth: { type: Number, default: 0 },
  },
  timestamps,
);
evictOnWrite(planSchema, 'Plan');

const agencySchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    planId: { type: String, required: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    branding: {
      logoUrl: String,
      primaryColor: String,
      customDomain: String,
    },
    enabledModules: [{ type: String }],
    moduleGrants: [{ type: String }],
    moduleDenies: [{ type: String }],
  },
  timestamps,
);
evictOnWrite(agencySchema, 'Agency');

const accountSchema = new Schema(
  {
    agencyId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, lowercase: true },
    status: { type: String, enum: ['active', 'paused', 'archived'], default: 'active' },
    timezone: { type: String, default: 'America/Denver' },
    markets: [{ type: String }],
    enabledModules: [{ type: String }],
    moduleGrants: [{ type: String }],
    moduleDenies: [{ type: String }],
  },
  timestamps,
);
accountSchema.index({ agencyId: 1, slug: 1 }, { unique: true });
evictOnWrite(accountSchema, 'Account');

const roleSchema = new Schema(
  {
    /** Null for the seeded system roles shared by every agency. */
    agencyId: { type: String, index: true, default: null },
    key: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    scope: { type: String, enum: ['platform', 'agency', 'account'], required: true },
    permissions: [{ type: String }],
    isSystem: { type: Boolean, default: false },
  },
  timestamps,
);
roleSchema.index({ agencyId: 1, key: 1 }, { unique: true });
evictOnWrite(roleSchema, 'Role');

const membershipSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    scope: { type: String, enum: ['platform', 'agency', 'account'], required: true },
    agencyId: { type: String, index: true },
    accountId: { type: String, index: true },
    roleId: { type: String, required: true },
    permissionOverrides: {
      grant: [{ type: String }],
      deny: [{ type: String }],
    },
    status: { type: String, enum: ['active', 'invited', 'suspended'], default: 'active' },
  },
  timestamps,
);
/**
 * One membership per user per sub-account, and one agency seat per user per agency — a
 * second row in either place would make effective permissions ambiguous.
 *
 * Two partial indexes rather than one sparse one. A sparse *compound* index still indexes a
 * document that has any one of its keys, and every membership has a `userId`: agency seats,
 * which carry no `accountId`, all collided on `{ userId, accountId: null }`, so nobody could
 * hold an agency seat in a second agency. Partial filters say what is actually meant.
 */
membershipSchema.index(
  { userId: 1, accountId: 1 },
  { unique: true, partialFilterExpression: { accountId: { $type: 'string' } } },
);
membershipSchema.index(
  { userId: 1, agencyId: 1, scope: 1 },
  { unique: true, partialFilterExpression: { scope: 'agency' } },
);

const auditLogSchema = new Schema(
  {
    agencyId: { type: String, index: true },
    accountId: { type: String, index: true },
    /**
     * Who did it. Absent for events with no authenticated actor — a refused sign-in is
     * exactly the kind of thing worth recording, and by definition nobody is signed in.
     */
    userId: { type: String },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: String,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    ip: String,
  },
  timestamps,
);
auditLogSchema.index({ agencyId: 1, accountId: 1, createdAt: -1 });

// ── Tenant-scoped collections ───────────────────────────────────────────────

/**
 * One parcel. A contact holds any number; one is primary.
 *
 * `id` is a stable string the UI uses to edit a single parcel, in the same way pipeline
 * stages carry their own id. Mongoose's `_id` is suppressed so there is only one.
 */
const parcelSchema = new Schema(
  {
    id: { type: String, required: true },
    isPrimary: { type: Boolean, default: false },
    apn: String,
    county: String,
    state: String,
    acres: Number,
    assessedValue: Number,
    legalDescription: String,
  },
  { _id: false },
);

const contactSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    /** `phone` as `1` + ten digits, the form everything matches on. See `src/shared/phone`. */
    phoneDigits: String,
    altPhones: [{ type: String }],
    altPhoneDigits: [{ type: String }],
    company: String,
    status: {
      type: String,
      enum: ['new', 'contacted', 'qualified', 'unqualified', 'do_not_call'],
      default: 'new',
    },
    source: String,
    ownerId: String,
    tags: [{ type: String }],
    address: {
      street: String,
      city: String,
      state: String,
      postalCode: String,
      country: { type: String, default: 'US' },
    },
    /**
     * The primary parcel, kept as a copy of the one in `properties` marked primary.
     *
     * Derived, never written directly: every index, filter, export column and search token
     * that existed when a contact had one parcel keeps reading this field, and the save hook
     * below keeps it in step. A land owner with several parcels has them all in `properties`.
     */
    property: {
      id: String,
      isPrimary: Boolean,
      apn: String,
      county: String,
      state: String,
      acres: Number,
      assessedValue: Number,
      legalDescription: String,
    },
    properties: { type: [parcelSchema], default: [] },
    customFields: { type: Schema.Types.Mixed, default: {} },
    dnc: { type: Boolean, default: false },
    lastActivityAt: Date,
    sourceSystem: { type: String, enum: ['ghl', 'zoho', 'import', 'manual'], default: 'manual' },
    sourceId: String,
    /** The import that created this contact — what "undo that import" deletes by. */
    importJobId: String,
    /**
     * The static lists this contact belongs to.
     *
     * Membership lives here rather than as an id array on the list. A list that holds its
     * own members is one document that grows with every import — 400,000 ids is past
     * MongoDB's 16 MB document limit — and filtering by it meant shipping that whole array
     * back as an `$in`. On the contact it is a small array, an indexed equality match, and
     * it disappears with the contact instead of being left behind in a list.
     */
    listIds: [{ type: String }],
    /** Lowercased words, email, APN and phone digits — see `modules/contacts/search.ts`. */
    searchTokens: { type: [String], select: false },
  },
  timestamps,
);
contactSchema.plugin(tenantScope);

/**
 * Derived fields, recomputed on every save so they cannot fall behind what they are built
 * from: the phone digits, the primary parcel, and the search tokens. Bulk paths that skip
 * document middleware (the import's `bulkWrite`) apply `deriveContactFields` themselves.
 */
contactSchema.pre('validate', function (this: any, next: (err?: Error) => void) {
  Object.assign(this, deriveContactFields(this));
  this.searchTokens = buildSearchTokens(this);
  next();
});

contactSchema.index({ agencyId: 1, accountId: 1, searchTokens: 1 });
contactSchema.index({ agencyId: 1, accountId: 1, listIds: 1 });
// The do-not-contact check on send looks recipients up by address.
contactSchema.index({ agencyId: 1, accountId: 1, email: 1 });
// Supports the default list view: tenant + recency.
contactSchema.index({ agencyId: 1, accountId: 1, status: 1, createdAt: -1 });
// Matching and duplicate detection compare digits, never the typed string.
contactSchema.index({ agencyId: 1, accountId: 1, phoneDigits: 1 }, { sparse: true });
contactSchema.index({ agencyId: 1, accountId: 1, altPhoneDigits: 1 }, { sparse: true });
contactSchema.index({ agencyId: 1, accountId: 1, tags: 1 });
contactSchema.index({ agencyId: 1, accountId: 1, ownerId: 1 }, { sparse: true });
contactSchema.index({ agencyId: 1, accountId: 1, importJobId: 1 }, { sparse: true });
contactSchema.index({ agencyId: 1, accountId: 1, lastActivityAt: -1 });
// Parcel filters match any of a contact's parcels, so the indexes are on the array.
contactSchema.index({ agencyId: 1, accountId: 1, 'properties.county': 1, 'properties.state': 1 });
contactSchema.index({ agencyId: 1, accountId: 1, 'properties.acres': 1 });
// Sorting the table by the primary parcel.
contactSchema.index({ agencyId: 1, accountId: 1, 'property.acres': 1 });
// Makes an idempotent re-import cheap to check, when the source system is known.
contactSchema.index(
  { agencyId: 1, accountId: 1, sourceSystem: 1, sourceId: 1 },
  { sparse: true },
);
/**
 * The import's own lookup, which knows a `sourceId` but not which system it came from.
 *
 * The index above cannot serve it: `sourceSystem` sits between the tenant prefix and
 * `sourceId`, so a query without it can only use the prefix and then scans. Measured on a
 * 20,000-row re-import, adding this took the match query from the dominant cost to noise.
 */
contactSchema.index({ agencyId: 1, accountId: 1, sourceId: 1 }, { sparse: true });

const contactFieldSchema = new Schema(
  {
    entity: { type: String, enum: ['contact', 'opportunity'], required: true },
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, required: true },
    options: [{ type: String }],
    required: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  timestamps,
);
contactFieldSchema.plugin(tenantScope);

const contactListSchema = new Schema(
  {
    name: { type: String, required: true },
    description: String,
    type: { type: String, enum: ['static', 'smart'], default: 'static' },
    filter: Schema.Types.Mixed,
    // No member ids and no stored count: static membership is `Contact.listIds`, and both
    // kinds of list are counted at read time, so the number cannot go stale.
  },
  timestamps,
);
contactListSchema.plugin(tenantScope);

const pipelineSchema = new Schema(
  {
    name: { type: String, required: true },
    stages: [
      new Schema(
        {
          id: { type: String, required: true },
          name: { type: String, required: true },
          order: { type: Number, default: 0 },
          color: { type: String, default: 'neutral' },
          probability: { type: Number, default: 0, min: 0, max: 100 },
        },
        // Stages carry their own stable string `id`, referenced by opportunity.stageId.
        // Suppressing `_id` keeps that the only identifier a stage has.
        { _id: false },
      ),
    ],
    isDefault: { type: Boolean, default: false },
  },
  timestamps,
);
pipelineSchema.plugin(tenantScope);

const opportunitySchema = new Schema(
  {
    pipelineId: { type: String, required: true },
    stageId: { type: String, required: true },
    contactId: { type: String, required: true },
    name: { type: String, required: true },
    value: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    status: { type: String, enum: ['open', 'won', 'lost', 'abandoned'], default: 'open' },
    ownerId: String,
    expectedCloseDate: Date,
    lostReason: String,
    customFields: { type: Schema.Types.Mixed, default: {} },
    order: { type: Number, default: 0 },
  },
  timestamps,
);
opportunitySchema.plugin(tenantScope);
// The board query: every open card in one pipeline, grouped by stage.
opportunitySchema.index({ agencyId: 1, accountId: 1, pipelineId: 1, stageId: 1, order: 1 });
opportunitySchema.index({ agencyId: 1, accountId: 1, contactId: 1 });

const activitySchema = new Schema(
  {
    /** One of `ACTIVITY_TYPES` — the history contract every module writes through. */
    type: { type: String, required: true, enum: [...ACTIVITY_TYPES] },
    contactId: { type: String, index: true },
    opportunityId: { type: String, index: true },
    userId: String,
    title: { type: String, required: true },
    body: String,
    metadata: Schema.Types.Mixed,
    /** The record this entry came from, so the history can open it. */
    channelRef: {
      kind: { type: String, enum: ['email', 'call', 'sms', 'appointment', 'task', 'opportunity', 'import'] },
      id: String,
    },
    /** A note kept above the history. */
    pinned: { type: Boolean, default: false },
    occurredAt: { type: Date, default: Date.now },
  },
  timestamps,
);
activitySchema.plugin(tenantScope);
// The contact timeline, newest first — and the same filtered to one type, for the tabs.
activitySchema.index({ agencyId: 1, accountId: 1, contactId: 1, occurredAt: -1 });
activitySchema.index({ agencyId: 1, accountId: 1, contactId: 1, type: 1, occurredAt: -1 });
activitySchema.index({ agencyId: 1, accountId: 1, contactId: 1, pinned: 1 }, { sparse: true });

const taskSchema = new Schema(
  {
    title: { type: String, required: true },
    description: String,
    contactId: String,
    opportunityId: String,
    assigneeId: String,
    createdBy: String,
    dueAt: Date,
    completedAt: Date,
    status: { type: String, enum: ['open', 'done'], default: 'open' },
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
  },
  timestamps,
);
taskSchema.plugin(tenantScope);
// "My tasks": one person's open tasks in due order; and a contact's tasks.
taskSchema.index({ agencyId: 1, accountId: 1, assigneeId: 1, status: 1, dueAt: 1 });
taskSchema.index({ agencyId: 1, accountId: 1, contactId: 1, status: 1 });

/**
 * An appointment with a contact, entered by hand for now (decision D3).
 *
 * The calendars module, when built, syncs these and sets `externalRef`; nothing else about
 * the record changes, which is the point of having it in Contacts already.
 */
const appointmentSchema = new Schema(
  {
    contactId: { type: String, required: true },
    userId: { type: String, required: true },
    title: { type: String, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    location: String,
    notes: String,
    outcome: {
      type: String,
      enum: ['scheduled', 'held', 'no_show', 'rescheduled', 'cancelled'],
      default: 'scheduled',
    },
    externalRef: { provider: String, id: String },
  },
  timestamps,
);
appointmentSchema.plugin(tenantScope);
appointmentSchema.index({ agencyId: 1, accountId: 1, startsAt: 1 });
appointmentSchema.index({ agencyId: 1, accountId: 1, contactId: 1, startsAt: -1 });
appointmentSchema.index({ agencyId: 1, accountId: 1, userId: 1, startsAt: 1 });

/**
 * One record per import: who ran it, what it was told to do, and what it did.
 *
 * The contacts an import created carry its id (`Contact.importJobId`), which is what
 * makes undo possible without storing hundreds of thousands of ids on this document.
 */
const importJobSchema = new Schema(
  {
    userId: { type: String, required: true },
    fileName: { type: String, required: true },
    tag: String,
    listId: String,
    ownerId: String,
    strategy: { type: String, enum: ['update', 'skip', 'create'], default: 'update' },
    mapping: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['running', 'finished', 'failed', 'undone'], default: 'running' },
    totalRows: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    undoneAt: Date,
  },
  timestamps,
);
importJobSchema.plugin(tenantScope);

const emailIdentitySchema = new Schema(
  {
    fromName: { type: String, required: true },
    fromEmail: { type: String, required: true, lowercase: true },
    replyTo: String,
    verified: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
    /**
     * A pending confirmation that someone controls this address.
     *
     * Only the hash is kept, for the same reason as invite tokens: a leaked database should
     * not hand out working links. Cleared the moment the address is confirmed.
     */
    verifyTokenHash: { type: String, select: false, index: true },
    verifyExpiresAt: { type: Date },
  },
  timestamps,
);
emailIdentitySchema.plugin(tenantScope);

const emailTemplateSchema = new Schema(
  {
    name: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    mergeFields: [{ type: String }],
    category: String,
  },
  timestamps,
);
emailTemplateSchema.plugin(tenantScope);

const emailMessageSchema = new Schema(
  {
    contactId: { type: String, index: true },
    identityId: { type: String, required: true },
    direction: { type: String, enum: ['outbound', 'inbound'], default: 'outbound' },
    to: [{ type: String }],
    cc: [{ type: String }],
    subject: { type: String, required: true },
    body: { type: String, required: true },
    status: {
      type: String,
      enum: ['draft', 'queued', 'sent', 'delivered', 'bounced', 'failed'],
      default: 'draft',
    },
    sentAt: Date,
    openedAt: Date,
    clickedAt: Date,
    threadId: String,
    campaignId: String,
    error: String,
  },
  timestamps,
);
emailMessageSchema.plugin(tenantScope);
emailMessageSchema.index({ agencyId: 1, accountId: 1, contactId: 1, createdAt: -1 });


/**
 * Metered usage, for quotas measured over a rolling window.
 *
 * One row per accepted upload. The window is computed by summing rows newer than the cutoff
 * rather than by keeping a running counter: a counter has to be reset by something, and a
 * reset that fails leaves a tenant either throttled forever or not at all.
 *
 * `contentHash` exists so the same file is not charged twice. The import wizard sends the
 * CSV once to preview it and again to commit it — charging both would make the effective
 * limit half of what it says, while an attacker sending distinct payloads is still charged
 * in full.
 */
const usageEventSchema = new Schema(
  {
    kind: { type: String, required: true },
    bytes: { type: Number, required: true },
    contentHash: { type: String, required: true },
    userId: String,
    occurredAt: { type: Date, default: Date.now },
  },
  timestamps,
);
usageEventSchema.plugin(tenantScope);
// The quota query: this account's usage of one kind, inside the window.
usageEventSchema.index({ agencyId: 1, accountId: 1, kind: 1, occurredAt: -1 });
// Rows are only ever read within the window, so let Mongo discard them afterwards. The
// margin over the one-hour window absorbs clock skew between app servers.
usageEventSchema.index({ occurredAt: 1 }, { expireAfterSeconds: 3 * 60 * 60 });

/**
 * Fixed-window counters for rate limiting.
 *
 * In the database rather than in memory because the API runs as many short-lived instances
 * on a serverless platform: a counter held in one process is a limit of "N per instance",
 * which is no limit at all. The `_id` names the key and the window, so an increment is one
 * atomic upsert, and the TTL index clears a window out once it has closed.
 *
 * Not tenant-scoped — it is consulted before anyone is signed in.
 */
const rateLimitHitSchema = new Schema({
  _id: { type: String },
  hits: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});
rateLimitHitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ── Exports ─────────────────────────────────────────────────────────────────

export const User = mongoose.model('User', userSchema);
export const Plan = mongoose.model('Plan', planSchema);
export const Agency = mongoose.model('Agency', agencySchema);
export const Account = mongoose.model('Account', accountSchema);
export const Role = mongoose.model('Role', roleSchema);
export const Membership = mongoose.model('Membership', membershipSchema);
export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export const RateLimitHit = mongoose.model('RateLimitHit', rateLimitHitSchema);

export const Contact = mongoose.model('Contact', contactSchema);
export const ContactField = mongoose.model('ContactField', contactFieldSchema);
export const ContactList = mongoose.model('ContactList', contactListSchema);
export const Pipeline = mongoose.model('Pipeline', pipelineSchema);
export const Opportunity = mongoose.model('Opportunity', opportunitySchema);
export const Activity = mongoose.model('Activity', activitySchema);
export const UsageEvent = mongoose.model('UsageEvent', usageEventSchema);
export const Task = mongoose.model('Task', taskSchema);
export const Appointment = mongoose.model('Appointment', appointmentSchema);
export const ImportJob = mongoose.model('ImportJob', importJobSchema);
export const EmailIdentity = mongoose.model('EmailIdentity', emailIdentitySchema);
export const EmailTemplate = mongoose.model('EmailTemplate', emailTemplateSchema);
export const EmailMessage = mongoose.model('EmailMessage', emailMessageSchema);

export type UserDoc = InferSchemaType<typeof userSchema>;
export type AccountDoc = InferSchemaType<typeof accountSchema>;
export type AgencyDoc = InferSchemaType<typeof agencySchema>;
export type ContactDoc = InferSchemaType<typeof contactSchema>;

export type ModuleKeyList = ModuleKey[];
