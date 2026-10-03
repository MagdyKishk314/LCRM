/**
 * CSV serialisation and parsing for contact import/export.
 *
 * Hand-written rather than pulled from a dependency because the rules that matter here are
 * few and worth being explicit about: RFC 4180 quoting, and the spreadsheet-injection guard
 * below, which a generic CSV library will not do for you.
 */

export const CONTACT_EXPORT_COLUMNS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'status',
  'source',
  'tags',
  'dnc',
  'company',
  'address.city',
  'address.state',
  'address.postalCode',
  'property.apn',
  'property.county',
  'property.state',
  'property.acres',
  'property.assessedValue',
  'createdAt',
] as const;

/** Every built-in column an export may include; the default set above is a subset. */
export const CONTACT_EXPORTABLE_COLUMNS = [
  ...CONTACT_EXPORT_COLUMNS,
  'altPhones',
  'owner',
  'address.street',
  'property.legalDescription',
  'lastActivityAt',
] as const;

/**
 * Quote a single CSV field.
 *
 * A leading `=`, `+`, `-` or `@` makes Excel and Sheets treat the value as a formula, so a
 * contact named `=cmd|...` becomes code execution when the exported file is opened. Those
 * are prefixed with an apostrophe, which spreadsheets strip on display.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';

  let str = Array.isArray(value) ? value.join('; ') : String(value);

  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;

  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvEscape).join(',');
}

/** Read a dotted path such as `property.acres` off a document. */
export function pluck(doc: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[part];
  }, doc);
}

export interface ParsedCsv {
  columns: string[];
  rows: string[][];
}

/**
 * Parse CSV text into a header row plus data rows.
 *
 * Handles quoted fields, escaped quotes (`""`), embedded commas and newlines, and both
 * CRLF and LF line endings. Rows shorter than the header are padded rather than dropped —
 * a trailing empty column is extremely common in exported files and is not an error.
 */
export function parseCsv(text: string, maxRows = Infinity): ParsedCsv {
  // Strip a UTF-8 BOM, which Excel writes and which would otherwise corrupt the first header.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // Consume the LF of a CRLF pair so it does not open an empty row.
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      if (rows.length > maxRows + 1) break;
    } else {
      field += char;
    }
  }

  // Whatever is left after the final line, if the file has no trailing newline.
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);

  const [header, ...body] = rows;
  const columns = (header ?? []).map((c) => c.trim());

  return {
    columns,
    rows: body.map((r) => {
      const padded = [...r];
      while (padded.length < columns.length) padded.push('');
      return padded.slice(0, columns.length);
    }),
  };
}

/**
 * Built-in fields an import may write to.
 *
 * Custom fields are importable too, as `cf.<key>`; the wizard adds them from the
 * sub-account's definitions, and the API accepts any `cf.` key that matches one.
 */
export const IMPORTABLE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'altPhone',
  'company',
  'status',
  'source',
  'tags',
  'address.street',
  'address.city',
  'address.state',
  'address.postalCode',
  'property.apn',
  'property.county',
  'property.state',
  'property.acres',
  'property.assessedValue',
  'property.legalDescription',
  'externalId',
] as const;

export type ImportableField = (typeof IMPORTABLE_FIELDS)[number];

/** The prefix a custom field carries in an import mapping and an export column list. */
export const CUSTOM_FIELD_PREFIX = 'cf.';

/** Human labels for the built-in fields, for mapping dropdowns and column pickers. */
export const CONTACT_FIELD_LABEL: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  altPhone: 'Alternate phone',
  company: 'Company',
  status: 'Status',
  source: 'Source',
  tags: 'Tags',
  dnc: 'Do not call',
  owner: 'Owner',
  'address.street': 'Street',
  'address.city': 'City',
  'address.state': 'Mailing state',
  'address.postalCode': 'Postal code',
  'property.apn': 'APN',
  'property.county': 'County',
  'property.state': 'Parcel state',
  'property.acres': 'Acres',
  'property.assessedValue': 'Assessed value',
  'property.legalDescription': 'Legal description',
  externalId: 'External id',
  createdAt: 'Created',
  lastActivityAt: 'Last activity',
};

/** Header spellings seen in Zoho, GHL and typical skip-trace exports. */
const HEADER_ALIASES: Record<string, ImportableField> = {
  'first name': 'firstName',
  first: 'firstName',
  firstname: 'firstName',
  fname: 'firstName',
  'owner first name': 'firstName',
  'last name': 'lastName',
  last: 'lastName',
  lastname: 'lastName',
  lname: 'lastName',
  surname: 'lastName',
  'owner last name': 'lastName',
  email: 'email',
  'email address': 'email',
  'e-mail': 'email',
  phone: 'phone',
  'phone number': 'phone',
  mobile: 'phone',
  'cell phone': 'phone',
  'primary phone': 'phone',
  telephone: 'phone',
  'phone 2': 'altPhone',
  'alt phone': 'altPhone',
  'alternate phone': 'altPhone',
  'secondary phone': 'altPhone',
  'phone2': 'altPhone',
  company: 'company',
  organization: 'company',
  status: 'status',
  source: 'source',
  'lead source': 'source',
  tags: 'tags',
  street: 'address.street',
  address: 'address.street',
  'mailing address': 'address.street',
  city: 'address.city',
  'mailing city': 'address.city',
  state: 'address.state',
  'mailing state': 'address.state',
  zip: 'address.postalCode',
  zipcode: 'address.postalCode',
  'postal code': 'address.postalCode',
  'mailing zip': 'address.postalCode',
  apn: 'property.apn',
  'parcel number': 'property.apn',
  'parcel id': 'property.apn',
  'assessor parcel number': 'property.apn',
  county: 'property.county',
  'property county': 'property.county',
  'property state': 'property.state',
  acres: 'property.acres',
  acreage: 'property.acres',
  'lot size': 'property.acres',
  'assessed value': 'property.assessedValue',
  'market value': 'property.assessedValue',
  id: 'externalId',
  'record id': 'externalId',
  'external id': 'externalId',
};

/**
 * Guess which contact field each CSV column maps to.
 *
 * A suggestion only — the import UI shows the mapping and lets the user correct it before
 * anything is written.
 */
export function suggestMapping(columns: string[]): Record<string, ImportableField | ''> {
  const mapping: Record<string, ImportableField | ''> = {};
  const taken = new Set<ImportableField>();

  for (const column of columns) {
    const key = column.trim().toLowerCase().replace(/[_-]+/g, ' ');
    const guess = HEADER_ALIASES[key];

    // One column per field: a file with both "Phone" and "Mobile" maps the first and
    // leaves the second for the user to assign.
    if (guess && !taken.has(guess)) {
      mapping[column] = guess;
      taken.add(guess);
    } else {
      mapping[column] = '';
    }
  }

  return mapping;
}
