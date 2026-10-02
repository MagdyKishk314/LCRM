import { formatPhone, type Contact } from '@landcaller/shared';

/**
 * CNT-31 / CNT-32 — the columns the table can show.
 *
 * `sort` is the API field a header click sorts by; columns without one are not sortable.
 * Custom fields are added at render time from the sub-account's definitions, keyed
 * `cf.<key>`. The chosen set is remembered per browser in localStorage.
 */
export interface Column {
  key: string;
  label: string;
  sort?: string;
  align?: 'left' | 'right';
  /** A plain-text cell; the table renders a few columns (name, status, tags) itself. */
  cell?: (c: Contact) => string;
}

export const COLUMNS: Column[] = [
  { key: 'name', label: 'Name', sort: 'lastName' },
  { key: 'status', label: 'Status', sort: 'status' },
  { key: 'phone', label: 'Phone', cell: (c) => (c.phone ? formatPhone(c.phone) : '') },
  { key: 'email', label: 'Email', cell: (c) => c.email ?? '' },
  { key: 'parcel', label: 'Parcel', sort: 'property.county', cell: (c) => (c.property?.county ? `${c.property.county} Co, ${c.property.state ?? ''}`.trim() : '') },
  { key: 'apn', label: 'APN', cell: (c) => c.property?.apn ?? '' },
  { key: 'acres', label: 'Acres', sort: 'property.acres', align: 'right', cell: (c) => (c.property?.acres !== undefined && c.property?.acres !== null ? Number(c.property.acres).toFixed(2) : '') },
  { key: 'value', label: 'Assessed', sort: 'property.assessedValue', align: 'right', cell: (c) => (c.property?.assessedValue ? `$${Number(c.property.assessedValue).toLocaleString()}` : '') },
  { key: 'parcels', label: 'Parcels', align: 'right', cell: (c) => (c.properties?.length > 1 ? String(c.properties.length) : '') },
  { key: 'owner', label: 'Owner', sort: 'ownerId' },
  { key: 'source', label: 'Source', sort: 'source', cell: (c) => c.source ?? '' },
  { key: 'company', label: 'Company', cell: (c) => c.company ?? '' },
  { key: 'tags', label: 'Tags' },
  { key: 'city', label: 'City', cell: (c) => [c.address?.city, c.address?.state].filter(Boolean).join(', ') },
  { key: 'lastActivity', label: 'Last activity', sort: 'lastActivityAt' },
  { key: 'created', label: 'Created', sort: 'createdAt' },
];

export const DEFAULT_COLUMNS = ['name', 'status', 'phone', 'parcel', 'acres', 'tags', 'lastActivity'];

export const columnStorageKey = (accountId: string) => `lc:contacts:columns:${accountId}`;

export function loadColumns(accountId: string): string[] {
  try {
    const raw = window.localStorage.getItem(columnStorageKey(accountId));
    const parsed = raw ? (JSON.parse(raw) as string[]) : null;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

export function saveColumns(accountId: string, keys: string[]) {
  try {
    window.localStorage.setItem(columnStorageKey(accountId), JSON.stringify(keys));
  } catch {
    // A private window or a full store: the choice simply does not persist.
  }
}
