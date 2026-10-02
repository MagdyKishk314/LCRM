/**
 * Phone numbers, normalised once and compared as digits.
 *
 * Owner lists arrive with every format a skip-trace vendor or a spreadsheet can produce:
 * `(303) 555-0142`, `303.555.0142`, `+1 303 555 0142`, `13035550142`. Matching, duplicate
 * detection and search compare the digits; what was typed is kept for display.
 *
 * US numbers only (decision D1 in Plans/CONTACTS-PLAN.md): ten digits get the country code,
 * eleven starting with `1` are kept, and anything else has no digits form — it is stored as
 * typed, never matched on, and flagged in the UI.
 */

/** The canonical form: `1` plus ten digits, or `null` when the input is not a US number. */
export function phoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  return null;
}

/** `(303) 555-0142` for a US number; the input unchanged otherwise. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = phoneDigits(raw);
  if (!digits) return raw;
  return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
}

/** Whether the value is something a US dialer could place a call to. */
export function isUsPhone(raw: string | null | undefined): boolean {
  return phoneDigits(raw) !== null;
}
