import type { ModuleKey } from '../modules/types';
import type { Permission } from '../permissions';
import type { MembershipScope } from '../roles';

export type ID = string;
export type ISODate = string;

/** Every tenant-scoped document carries both discriminators. */
export interface TenantScoped {
  agencyId: ID;
  accountId: ID;
}

export interface Timestamped {
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ── Identity & tenancy ──────────────────────────────────────────────────────

export interface User extends Timestamped {
  id: ID;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatarUrl?: string;
  status: 'active' | 'invited' | 'suspended';
  mfaEnabled: boolean;
  lastLoginAt?: ISODate;
}

export interface Agency extends Timestamped {
  id: ID;
  name: string;
  slug: string;
  planId: ID;
  status: 'active' | 'suspended';
  branding: { logoUrl?: string; primaryColor?: string; customDomain?: string };
  enabledModules: ModuleKey[];
  moduleGrants: ModuleKey[];
  moduleDenies: ModuleKey[];
  accountCount?: number;
}

export interface Account extends Timestamped {
  id: ID;
  agencyId: ID;
  name: string;
  slug: string;
  status: 'active' | 'paused' | 'archived';
  timezone: string;
  /** LandCaller-specific: the markets this client buys land in. */
  markets?: string[];
  enabledModules: ModuleKey[];
  moduleGrants: ModuleKey[];
  moduleDenies: ModuleKey[];
  contactCount?: number;
  userCount?: number;
}

export interface Role extends Timestamped {
  id: ID;
  agencyId?: ID;
  key: string;
  name: string;
  description: string;
  scope: MembershipScope;
  permissions: Permission[];
  isSystem: boolean;
}

export interface Membership extends Timestamped {
  id: ID;
  userId: ID;
  scope: MembershipScope;
  agencyId?: ID;
  accountId?: ID;
  roleId: ID;
  permissionOverrides: { grant: Permission[]; deny: Permission[] };
  status: 'active' | 'invited' | 'suspended';
}

export interface Plan extends Timestamped {
  id: ID;
  name: string;
  modules: ModuleKey[];
  limits: { accounts: number; users: number; contacts: number };
  pricePerMonth: number;
}

// ── Session ─────────────────────────────────────────────────────────────────

/** What the frontend needs to render the shell: who you are, where you are, what you can do. */
export interface SessionContext {
  user: User;
  /** Every account this user can switch into, across every agency. */
  accounts: { id: ID; name: string; agencyId: ID; agencyName: string }[];
  activeAgency: Agency | null;
  activeAccount: Account | null;
  /** Effective module set for the active account, already resolved server-side. */
  enabledModules: ModuleKey[];
  /** Effective permissions for the active membership. */
  permissions: Permission[];
  /** Scope of the membership backing the *active sub-account*. */
  scope: MembershipScope;
  /**
   * Whether this user may use the agency console.
   *
   * Independent of `scope`, which describes the active sub-account and is meaningless
   * when an agency has no sub-accounts yet.
   */
  hasAgencyAccess: boolean;
  /**
   * The context this session is running in, honouring the choice made at login.
   *
   * `hasAgencyAccess` says what the user *could* reach; this says where they are. Someone
   * who entered as a sub-account member sees no agency affordances even though they hold
   * an agency membership.
   */
  activeContext: 'agency' | 'account';
  /**
   * Every context this login can enter — the agency console, and each sub-account the
   * user holds a direct membership on. More than one means the user is asked to choose,
   * because those are different jobs with different data, not a default to guess at.
   */
  destinations: LoginDestination[];
}

export interface LoginDestination {
  type: 'agency' | 'account';
  id: string | null;
  name: string;
  roleName: string;
  href: string;
}

// ── Contacts ────────────────────────────────────────────────────────────────

export type CustomFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'email'
  | 'phone'
  | 'url';

export interface CustomFieldDef extends TenantScoped, Timestamped {
  id: ID;
  entity: 'contact' | 'opportunity';
  key: string;
  label: string;
  type: CustomFieldType;
  options?: string[];
  required: boolean;
  order: number;
}

export interface Contact extends TenantScoped, Timestamped {
  id: ID;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  /** `phone` as digits (`1` + ten), the form everything matches on. Absent for a non-US number. */
  phoneDigits?: string;
  altPhones?: string[];
  altPhoneDigits?: string[];
  company?: string;
  status: 'new' | 'contacted' | 'qualified' | 'unqualified' | 'do_not_call';
  source?: string;
  ownerId?: ID;
  tags: string[];
  /** Mailing address of the owner. */
  address?: Address;
  /** The primary parcel — a copy of the one in `properties` marked primary. Read-only. */
  property?: PropertyInfo;
  /** Every parcel this owner holds. One is primary; the table and search use that one. */
  properties: PropertyInfo[];
  customFields: Record<string, unknown>;
  dnc: boolean;
  lastActivityAt?: ISODate;
  sourceSystem?: 'ghl' | 'zoho' | 'import' | 'manual';
  sourceId?: string;
  /** The import that created this contact, when one did. */
  importJobId?: ID;
  /** The static lists this contact belongs to. */
  listIds?: ID[];
}

/** A contact as the detail endpoint returns it: the record plus everything around it. */
export interface ContactDetail extends Contact {
  owner: { id: ID; name: string } | null;
  fieldDefinitions: CustomFieldDef[];
  lists: { id: ID; name: string; type: 'static' | 'smart' }[];
  opportunities: Opportunity[];
  openTasks: Task[];
  upcomingAppointments: Appointment[];
  pinnedNotes: Activity[];
  historyCounts: Partial<Record<ActivityType, number>>;
  history: HistoryPage;
}

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface PropertyInfo {
  /** Stable id within the contact, so an edit targets one parcel. */
  id?: string;
  isPrimary?: boolean;
  apn?: string;
  county?: string;
  state?: string;
  acres?: number;
  assessedValue?: number;
  legalDescription?: string;
}

export interface ContactList extends TenantScoped, Timestamped {
  id: ID;
  name: string;
  description?: string;
  /** `static` holds an explicit member set; `smart` re-evaluates its filter on read. */
  type: 'static' | 'smart';
  filter?: ContactFilter;
  /** Counted when the list is read, never stored — so it cannot go stale. */
  memberCount: number;
}

import type { ContactFilter } from '../contact-filter';
export type { ContactFilter };

// ── Pipelines ───────────────────────────────────────────────────────────────

export interface PipelineStage {
  id: ID;
  name: string;
  order: number;
  color: string;
  /** Used for weighted forecasting. 0-100. */
  probability: number;
}

export interface Pipeline extends TenantScoped, Timestamped {
  id: ID;
  name: string;
  stages: PipelineStage[];
  isDefault: boolean;
}

export interface Opportunity extends TenantScoped, Timestamped {
  id: ID;
  pipelineId: ID;
  stageId: ID;
  contactId: ID;
  name: string;
  value: number;
  currency: string;
  status: 'open' | 'won' | 'lost' | 'abandoned';
  ownerId?: ID;
  expectedCloseDate?: ISODate;
  lostReason?: string;
  customFields: Record<string, unknown>;
  /** Position within its stage column, so manual ordering survives a reload. */
  order: number;
}

// ── Email ───────────────────────────────────────────────────────────────────

export interface EmailIdentity extends TenantScoped, Timestamped {
  id: ID;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  verified: boolean;
  isDefault: boolean;
}

export interface EmailTemplate extends TenantScoped, Timestamped {
  id: ID;
  name: string;
  subject: string;
  body: string;
  /** Merge fields detected in subject + body, e.g. `contact.firstName`. */
  mergeFields: string[];
  category?: string;
}

export interface EmailMessage extends TenantScoped, Timestamped {
  id: ID;
  contactId?: ID;
  identityId: ID;
  direction: 'outbound' | 'inbound';
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  status: 'draft' | 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed';
  sentAt?: ISODate;
  openedAt?: ISODate;
  clickedAt?: ISODate;
  threadId?: ID;
  campaignId?: ID;
  error?: string;
}

// ── History ─────────────────────────────────────────────────────────────────

/**
 * Every kind of entry a contact's history can hold.
 *
 * This is the contract other modules write through (CNT-13): telephony writes `call` and
 * `sms`, email writes `email`, calendars will write `appointment`. The contacts module
 * renders them all from one list and one endpoint.
 */
export const ACTIVITY_TYPES = [
  'note',
  'call',
  'sms',
  'email',
  'appointment',
  'task',
  'status_change',
  'stage_change',
  'field_change',
  'list_change',
  'import',
  'merge',
  'created',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** The record an entry came from, so the history can open it. */
export interface ChannelRef {
  kind: 'email' | 'call' | 'sms' | 'appointment' | 'task' | 'opportunity' | 'import';
  id: ID;
}

export interface Activity extends TenantScoped, Timestamped {
  id: ID;
  type: ActivityType;
  contactId?: ID;
  opportunityId?: ID;
  /** Who did it. Absent for system-generated entries such as an import. */
  userId?: ID;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  channelRef?: ChannelRef;
  /** A note kept above the history — "speaks Spanish", "wants cash only". */
  pinned?: boolean;
  occurredAt: ISODate;
}

/** A history entry as the history endpoint returns it: with the actor resolved. */
export interface HistoryEntry extends Activity {
  actor: { id: ID; name: string } | null;
  /** The email behind an `email` entry, for the Emails tab. */
  email?: Pick<EmailMessage, 'id' | 'subject' | 'direction' | 'status' | 'to' | 'sentAt' | 'openedAt'> | null;
}

export interface HistoryPage {
  data: HistoryEntry[];
  /** Pass as `before` to fetch the next, older page. Null when there is no more. */
  nextCursor: string | null;
}

export interface Task extends TenantScoped, Timestamped {
  id: ID;
  title: string;
  description?: string;
  contactId?: ID;
  opportunityId?: ID;
  assigneeId?: ID;
  createdBy?: ID;
  dueAt?: ISODate;
  completedAt?: ISODate;
  status: 'open' | 'done';
  priority: 'low' | 'normal' | 'high';
}

export const APPOINTMENT_OUTCOMES = ['scheduled', 'held', 'no_show', 'rescheduled', 'cancelled'] as const;
export type AppointmentOutcome = (typeof APPOINTMENT_OUTCOMES)[number];

export interface Appointment extends TenantScoped, Timestamped {
  id: ID;
  contactId: ID;
  /** The team member the appointment is with. */
  userId: ID;
  title: string;
  startsAt: ISODate;
  endsAt: ISODate;
  /** An address, or "phone" — where it happens. */
  location?: string;
  notes?: string;
  outcome: AppointmentOutcome;
  /** Set when a calendar module syncs it; absent for ones entered by hand. */
  externalRef?: { provider: string; id: string };
}

export interface ImportJob extends TenantScoped, Timestamped {
  id: ID;
  userId: ID;
  fileName: string;
  tag?: string;
  listId?: ID;
  ownerId?: ID;
  strategy: 'update' | 'skip' | 'create';
  mapping: Record<string, string>;
  status: 'running' | 'finished' | 'failed' | 'undone';
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errorCount: number;
  startedAt: ISODate;
  finishedAt?: ISODate;
  undoneAt?: ISODate;
}

export interface AuditLog extends Timestamped {
  id: ID;
  agencyId?: ID;
  accountId?: ID;
  /** Absent for events with no signed-in actor, such as a refused sign-in. */
  userId?: ID;
  action: string;
  entity: string;
  entityId?: ID;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
}

// ── API envelopes ───────────────────────────────────────────────────────────

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
