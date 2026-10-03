import { randomUUID } from 'node:crypto';
import { phoneDigits } from '@/shared';

/**
 * The fields a contact carries that are computed from other fields.
 *
 * Applied in the model's save hook, and by hand on the bulk paths that skip it (the
 * import's `bulkWrite`, the migration). Pure, so the rules are testable without a database:
 *
 *   - `phoneDigits` / `altPhoneDigits`: the matching form of each number, or nothing for a
 *     number that is not a US number;
 *   - `properties`: every parcel has an id, exactly one is primary (the first, when none
 *     is marked), and a legacy single `property` with no `properties` is lifted in;
 *   - `property`: a copy of the primary parcel, for the indexes and columns that read it.
 */
export interface Parcel {
  id?: string | null;
  isPrimary?: boolean | null;
  apn?: string | null;
  county?: string | null;
  state?: string | null;
  acres?: number | null;
  assessedValue?: number | null;
  legalDescription?: string | null;
}

export interface Derivable {
  phone?: string | null;
  altPhones?: (string | null)[] | null;
  property?: Parcel | null;
  properties?: Parcel[] | null;
}

export interface Derived {
  phoneDigits: string | undefined;
  altPhoneDigits: string[];
  properties: Parcel[];
  property: Parcel | undefined;
}

const PARCEL_FIELDS = ['apn', 'county', 'state', 'acres', 'assessedValue', 'legalDescription'] as const;

function hasContent(parcel: Parcel | null | undefined): parcel is Parcel {
  return Boolean(parcel) && PARCEL_FIELDS.some((f) => parcel![f] !== undefined && parcel![f] !== null && parcel![f] !== '');
}

/** A parcel with only its data fields — no id, no primary flag — for comparing and copying. */
export function parcelFields(parcel: Parcel): Parcel {
  const out: Parcel = {};
  for (const f of PARCEL_FIELDS) {
    const v = parcel[f];
    if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[f] = v;
  }
  return out;
}

export function deriveContactFields(contact: Derivable): Derived {
  const digits = phoneDigits(contact.phone) ?? undefined;

  const altPhoneDigits = [
    ...new Set(
      (contact.altPhones ?? [])
        .map((p) => phoneDigits(p))
        .filter((d): d is string => d !== null && d !== digits),
    ),
  ];

  // Lift a legacy single parcel into the array when the array is empty.
  let properties: Parcel[] = (contact.properties ?? []).filter(hasContent);
  if (properties.length === 0 && hasContent(contact.property)) {
    properties = [{ ...parcelFields(contact.property), isPrimary: true }];
  }

  properties = properties.map((p) => ({ ...p, id: p.id || randomUUID() }));

  // Exactly one primary: the one marked, else the first.
  const primaryIndex = Math.max(
    0,
    properties.findIndex((p) => p.isPrimary),
  );
  properties = properties.map((p, i) => ({ ...p, isPrimary: i === primaryIndex }));

  const primary = properties[primaryIndex];

  return {
    phoneDigits: digits,
    altPhoneDigits,
    properties,
    property: primary ? { ...primary } : undefined,
  };
}
