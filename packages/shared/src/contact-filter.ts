/**
 * One definition of "which contacts" — for the table, for exports, for bulk actions and
 * for smart lists.
 *
 * The same shape travels in a URL (`?status=new,contacted&acresMin=5`), is stored on a
 * smart list, and is sent in a bulk-action body. `parseContactFilter` reads any of those;
 * `contactFilterToParams` writes the URL form; `describeContactFilter` says it in words.
 * The API turns the parsed shape into a query in one place, so every surface acts on
 * exactly the same set of contacts.
 */

export const CONTACT_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'do_not_call'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  unqualified: 'Unqualified',
  do_not_call: 'Do not call',
};

/** A custom field condition: equality for most types, "contains" for multiselect. */
export type CustomFieldValue = string | number | boolean;

export interface ContactFilter {
  search?: string;
  status?: ContactStatus[];
  tags?: string[];
  /** Whether a contact must carry every tag, or any one of them. Defaults to `any`. */
  tagMode?: 'any' | 'all';
  /** Parcel state(s). */
  state?: string[];
  county?: string[];
  dnc?: boolean;
  acresMin?: number;
  acresMax?: number;
  valueMin?: number;
  valueMax?: number;
  /** A user id, `me` for the caller, or `none` for unassigned. */
  ownerId?: string;
  source?: string[];
  createdAfter?: string;
  createdBefore?: string;
  activityAfter?: string;
  activityBefore?: string;
  hasEmail?: boolean;
  hasPhone?: boolean;
  listId?: string;
  customFields?: Record<string, CustomFieldValue>;
}

export const CONTACT_FILTER_KEYS: (keyof ContactFilter)[] = [
  'search',
  'status',
  'tags',
  'tagMode',
  'state',
  'county',
  'dnc',
  'acresMin',
  'acresMax',
  'valueMin',
  'valueMax',
  'ownerId',
  'source',
  'createdAfter',
  'createdBefore',
  'activityAfter',
  'activityBefore',
  'hasEmail',
  'hasPhone',
  'listId',
  'customFields',
];

/** Custom field conditions travel as `cf.<key>=<value>` in a URL. */
const CF_PREFIX = 'cf.';

type Loose = Record<string, unknown>;

function list(value: unknown): string[] | undefined {
  const items = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const cleaned = items.map((s) => s.trim()).filter(Boolean);
  return cleaned.length > 0 ? [...new Set(cleaned)] : undefined;
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function num(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** An ISO date, or a `YYYY-MM-DD` day, kept as given when it parses. */
function date(value: unknown): string | undefined {
  const s = text(value);
  if (!s) return undefined;
  return Number.isNaN(new Date(s).getTime()) ? undefined : s;
}

function customFieldValue(value: unknown): CustomFieldValue | undefined {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  if (!s) return undefined;
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

/**
 * Read a filter from a URL's search params, a stored smart-list filter, or a request body.
 *
 * Tolerant on purpose: arrays or comma-separated strings, booleans or `'true'`, numbers or
 * numeric strings. Unknown keys are ignored, and anything empty is dropped, so the result
 * contains only conditions that narrow something — which is what `isEmptyContactFilter`
 * relies on to refuse a bulk delete of everything.
 */
export function parseContactFilter(input: Loose | null | undefined): ContactFilter {
  if (!input) return {};
  const out: ContactFilter = {};

  const search = text(input.search);
  if (search) out.search = search;

  const status = list(input.status)?.filter((s): s is ContactStatus =>
    (CONTACT_STATUSES as readonly string[]).includes(s),
  );
  if (status && status.length > 0) out.status = status;

  // `tag` (singular) is the older URL spelling; both are read.
  const tags = list(input.tags) ?? list(input.tag);
  if (tags) out.tags = tags;
  if (input.tagMode === 'all') out.tagMode = 'all';

  const state = list(input.state);
  if (state) out.state = state.map((s) => s.toUpperCase());
  const county = list(input.county);
  if (county) out.county = county;

  const dnc = bool(input.dnc);
  if (dnc !== undefined) out.dnc = dnc;

  for (const key of ['acresMin', 'acresMax', 'valueMin', 'valueMax'] as const) {
    const n = num(input[key]);
    if (n !== undefined) out[key] = n;
  }

  const ownerId = text(input.ownerId);
  if (ownerId) out.ownerId = ownerId;

  const source = list(input.source);
  if (source) out.source = source;

  for (const key of ['createdAfter', 'createdBefore', 'activityAfter', 'activityBefore'] as const) {
    const d = date(input[key]);
    if (d) out[key] = d;
  }

  const hasEmail = bool(input.hasEmail);
  if (hasEmail !== undefined) out.hasEmail = hasEmail;
  const hasPhone = bool(input.hasPhone);
  if (hasPhone !== undefined) out.hasPhone = hasPhone;

  const listId = text(input.listId);
  if (listId) out.listId = listId;

  const customFields: Record<string, CustomFieldValue> = {};
  if (input.customFields && typeof input.customFields === 'object') {
    for (const [k, v] of Object.entries(input.customFields as Loose)) {
      const value = customFieldValue(v);
      if (value !== undefined && isSafeKey(k)) customFields[k] = value;
    }
  }
  for (const [k, v] of Object.entries(input)) {
    if (!k.startsWith(CF_PREFIX)) continue;
    const key = k.slice(CF_PREFIX.length);
    const value = customFieldValue(Array.isArray(v) ? v[0] : v);
    if (value !== undefined && isSafeKey(key)) customFields[key] = value;
  }
  if (Object.keys(customFields).length > 0) out.customFields = customFields;

  return out;
}

/** Custom field keys become Mongo paths, so a dot or a leading `$` must never get through. */
export function isSafeKey(key: string): boolean {
  return key.length > 0 && key.length <= 60 && !key.includes('.') && !key.startsWith('$');
}

/** The URL form: every condition as a string, arrays comma-joined, custom fields prefixed. */
export function contactFilterToParams(filter: ContactFilter): Record<string, string> {
  const out: Record<string, string> = {};

  if (filter.search) out.search = filter.search;
  if (filter.status?.length) out.status = filter.status.join(',');
  if (filter.tags?.length) out.tags = filter.tags.join(',');
  if (filter.tagMode === 'all') out.tagMode = 'all';
  if (filter.state?.length) out.state = filter.state.join(',');
  if (filter.county?.length) out.county = filter.county.join(',');
  if (filter.dnc !== undefined) out.dnc = String(filter.dnc);
  for (const key of ['acresMin', 'acresMax', 'valueMin', 'valueMax'] as const) {
    if (filter[key] !== undefined) out[key] = String(filter[key]);
  }
  if (filter.ownerId) out.ownerId = filter.ownerId;
  if (filter.source?.length) out.source = filter.source.join(',');
  for (const key of ['createdAfter', 'createdBefore', 'activityAfter', 'activityBefore'] as const) {
    if (filter[key]) out[key] = filter[key]!;
  }
  if (filter.hasEmail !== undefined) out.hasEmail = String(filter.hasEmail);
  if (filter.hasPhone !== undefined) out.hasPhone = String(filter.hasPhone);
  if (filter.listId) out.listId = filter.listId;
  for (const [k, v] of Object.entries(filter.customFields ?? {})) out[`${CF_PREFIX}${k}`] = String(v);

  return out;
}

/** True when the filter would match every contact in the sub-account. */
export function isEmptyContactFilter(filter: ContactFilter | null | undefined): boolean {
  if (!filter) return true;
  return Object.keys(parseContactFilter(filter as Loose)).length === 0;
}

/** How many separate conditions a filter carries — for a "3 filters" badge. */
export function countContactFilterConditions(filter: ContactFilter): number {
  const parsed = parseContactFilter(filter as Loose);
  let n = 0;
  for (const key of Object.keys(parsed) as (keyof ContactFilter)[]) {
    if (key === 'tagMode') continue;
    if (key === 'customFields') n += Object.keys(parsed.customFields ?? {}).length;
    else n += 1;
  }
  return n;
}

export interface FilterLabels {
  /** Owner id → display name, for the owner clause. */
  owners?: Record<string, string>;
  /** List id → name. */
  lists?: Record<string, string>;
  /** Custom field key → label. */
  fields?: Record<string, string>;
}

/**
 * The filter in words, one clause per condition — for a list card, a saved view, an
 * export's audit entry. "Status is Qualified or Contacted · Costilla or Alamosa County ·
 * 5–40 acres · tagged callback".
 */
export function describeContactFilter(filter: ContactFilter, labels: FilterLabels = {}): string[] {
  const f = parseContactFilter(filter as Loose);
  const clauses: string[] = [];
  const or = (items: string[]) => items.join(' or ');

  if (f.search) clauses.push(`matches "${f.search}"`);
  if (f.status) clauses.push(`status is ${or(f.status.map((s) => CONTACT_STATUS_LABEL[s]))}`);
  if (f.tags) clauses.push(`tagged ${f.tagMode === 'all' ? f.tags.join(' and ') : or(f.tags)}`);
  if (f.state) clauses.push(`parcel in ${or(f.state)}`);
  if (f.county) clauses.push(`${or(f.county)} County`);
  if (f.dnc === true) clauses.push('do not call');
  if (f.dnc === false) clauses.push('not on the do-not-call list');
  clauses.push(...range(f.acresMin, f.acresMax, 'acres'));
  clauses.push(...range(f.valueMin, f.valueMax, 'assessed', '$'));
  if (f.ownerId === 'me') clauses.push('owned by me');
  else if (f.ownerId === 'none') clauses.push('unassigned');
  else if (f.ownerId) clauses.push(`owned by ${labels.owners?.[f.ownerId] ?? 'one user'}`);
  if (f.source) clauses.push(`source ${or(f.source)}`);
  if (f.createdAfter || f.createdBefore) clauses.push(`created ${between(f.createdAfter, f.createdBefore)}`);
  if (f.activityAfter || f.activityBefore) clauses.push(`last activity ${between(f.activityAfter, f.activityBefore)}`);
  if (f.hasEmail === true) clauses.push('has an email');
  if (f.hasEmail === false) clauses.push('no email');
  if (f.hasPhone === true) clauses.push('has a phone');
  if (f.hasPhone === false) clauses.push('no phone');
  if (f.listId) clauses.push(`in list ${labels.lists?.[f.listId] ?? f.listId}`);
  for (const [k, v] of Object.entries(f.customFields ?? {})) {
    clauses.push(`${labels.fields?.[k] ?? k} is ${String(v)}`);
  }

  return clauses;
}

function range(min: number | undefined, max: number | undefined, unit: string, prefix = ''): string[] {
  const fmt = (n: number) => `${prefix}${n.toLocaleString()}`;
  if (min !== undefined && max !== undefined) return [`${fmt(min)}–${fmt(max)} ${unit}`];
  if (min !== undefined) return [`at least ${fmt(min)} ${unit}`];
  if (max !== undefined) return [`at most ${fmt(max)} ${unit}`];
  return [];
}

function between(after: string | undefined, before: string | undefined): string {
  const day = (s: string) => s.slice(0, 10);
  if (after && before) return `between ${day(after)} and ${day(before)}`;
  if (after) return `after ${day(after)}`;
  return `before ${day(before!)}`;
}
