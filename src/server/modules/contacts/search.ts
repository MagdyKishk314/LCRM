/**
 * Contact search that an index can answer.
 *
 * Search used to be an unanchored, case-insensitive regex across five fields — which no
 * index can serve, so every keystroke in the search box scanned the whole sub-account. On a
 * 300,000-contact import that is the slowest query in the product, run the most often.
 *
 * Instead each contact carries `searchTokens`: the lowercased words of its name and company,
 * its email, its APN, and its phone number as digits. A search term becomes an *anchored,
 * case-sensitive* prefix match against that array, which is a range scan on
 * `{ agencyId, accountId, searchTokens }`.
 *
 * What changes for the person typing:
 *   - "smi" still finds Smith, and "john smith" now finds John Smith (it did not before —
 *     no single field contains both words).
 *   - "(303) 555-0142", "3035550142" and "0142" all find the same phone.
 *   - A fragment from the *middle* of a word no longer matches: "son" does not find
 *     Johnson. That is the trade for not scanning.
 */

export interface Searchable {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  altPhones?: (string | null)[] | null;
  property?: { apn?: string | null } | null;
  /** Every parcel: any of an owner's APNs should find them. */
  properties?: ({ apn?: string | null } | null)[] | null;
}

/** Split on whitespace and list punctuation; everything else stays inside the word. */
function words(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.toLowerCase().split(/[\s,;]+/).filter(Boolean);
}

function alnum(value: string): string {
  return value.replace(/[^a-z0-9]/g, '');
}

/**
 * A phone number in the forms people actually type.
 *
 * The whole number, the number without a leading US country code, and the last seven and
 * four digits — so searching for the local part, or the four digits someone read out, works
 * as a prefix match like everything else.
 */
function phoneTokens(phone: string | null | undefined): string[] {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 4) return [];

  const out = [digits];
  if (digits.length === 11 && digits.startsWith('1')) out.push(digits.slice(1));
  if (digits.length > 7) out.push(digits.slice(-7));
  if (digits.length > 4) out.push(digits.slice(-4));
  return out;
}

/** Everything a contact can be found by. Pure, so it is testable without a database. */
export function buildSearchTokens(contact: Searchable): string[] {
  const tokens = new Set<string>();
  const add = (list: string[]) => list.forEach((t) => tokens.add(t));

  add(words(contact.firstName));
  add(words(contact.lastName));
  add(words(contact.company));

  if (contact.email) tokens.add(contact.email.toLowerCase().trim());

  add(phoneTokens(contact.phone));
  for (const alt of contact.altPhones ?? []) add(phoneTokens(alt));

  const apns = [contact.property?.apn, ...(contact.properties ?? []).map((p) => p?.apn)];
  for (const raw of apns) {
    const apn = raw?.toLowerCase().trim();
    if (!apn) continue;
    tokens.add(apn);
    // APNs are written with and without their separators, depending on the county.
    const bare = alnum(apn);
    if (bare) tokens.add(bare);
  }

  return [...tokens];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Turn what someone typed into Mongo conditions — one per word, all of which must match.
 *
 * Each word is tried as typed and with its punctuation stripped, so "555-0142" reaches the
 * digits-only phone token and "123-45-678" reaches the bare APN. Returns an empty array for
 * input with nothing searchable in it, which callers treat as "no search".
 */
export function searchConditions(search: string | null | undefined): Record<string, unknown>[] {
  return words(search?.trim()).map((term): Record<string, unknown> => {
    const forms = new Set([term]);
    const bare = alnum(term);
    if (bare) forms.add(bare);

    const alternatives = [...forms].map((form) => ({
      // Anchored and case-sensitive: the only shape of regex that becomes an index range.
      searchTokens: new RegExp(`^${escapeRegex(form)}`),
    }));

    return alternatives.length === 1 ? alternatives[0]! : { $or: alternatives };
  });
}
