import { isSafeKey } from '@/shared';
import { badRequest } from '../../core/errors';
import { ContactField } from '../../models';

/**
 * Custom field values, checked against their definitions before they are stored.
 *
 * A definition says what a value may be — a number, one of these options, a date — and
 * whether the field is required. Values were previously accepted as anything under any
 * key, so a form could store `"twelve"` in a currency field and nothing would say so
 * until a filter on it found nothing.
 */
export interface FieldDef {
  key: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
}

export async function contactFieldDefinitions(): Promise<FieldDef[]> {
  const defs = await ContactField.find({ entity: 'contact' }).sort({ order: 1 }).lean();
  return defs.map((d) => ({
    key: d.key,
    label: d.label,
    type: d.type,
    options: d.options,
    required: d.required,
  }));
}

const EMPTY = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Coerce and check one value for its definition. Returns the value to store, or throws
 * with the field's label in the message. An empty value clears the field.
 */
export function coerceCustomField(def: FieldDef, raw: unknown): unknown {
  if (EMPTY(raw)) return undefined;

  const fail = (what: string) => badRequest(`${def.label}: ${what}`);

  switch (def.type) {
    case 'number':
    case 'currency': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,$\s]/g, ''));
      if (!Number.isFinite(n)) throw fail('must be a number');
      return n;
    }
    case 'checkbox': {
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'yes' || raw === '1') return true;
      if (raw === 'false' || raw === 'no' || raw === '0') return false;
      throw fail('must be yes or no');
    }
    case 'date': {
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) throw fail('must be a date');
      return d.toISOString().slice(0, 10);
    }
    case 'select': {
      const s = String(raw);
      if (!(def.options ?? []).includes(s)) throw fail(`must be one of ${(def.options ?? []).join(', ')}`);
      return s;
    }
    case 'multiselect': {
      const items = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[,;]/).map((s) => s.trim());
      const cleaned = [...new Set(items.filter(Boolean))];
      const bad = cleaned.filter((s) => !(def.options ?? []).includes(s));
      if (bad.length > 0) throw fail(`${bad.join(', ')} is not an option`);
      return cleaned;
    }
    case 'email': {
      const s = String(raw).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw fail('must be an email address');
      return s;
    }
    case 'url': {
      const s = String(raw).trim();
      try {
        new URL(s.includes('://') ? s : `https://${s}`);
      } catch {
        throw fail('must be a web address');
      }
      return s;
    }
    default:
      return String(raw).slice(0, 5_000);
  }
}

/**
 * Validate a set of values. With `partial`, only the keys given are checked and required
 * fields may be absent (but not cleared); without it — a create — every required field
 * must be present.
 */
export function validateCustomFields(
  defs: FieldDef[],
  values: Record<string, unknown>,
  opts: { partial: boolean },
): Record<string, unknown> {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(values)) {
    if (!isSafeKey(key)) throw badRequest(`Custom field key "${key}" is not valid`);
    const def = byKey.get(key);
    if (!def) throw badRequest(`There is no custom field named "${key}"`);
    const value = coerceCustomField(def, raw);
    if (value === undefined && def.required) throw badRequest(`${def.label} is required`);
    out[key] = value;
  }

  if (!opts.partial) {
    for (const def of defs) {
      if (def.required && EMPTY(out[def.key])) throw badRequest(`${def.label} is required`);
    }
  }

  return out;
}
