/**
 * Do-not-contact, in one place.
 *
 * A contact carries two things that mean "never reach this person": the `dnc` flag the
 * dialer checks, and the `do_not_call` status the list view shows. They were written by
 * four different handlers that each kept them in step in their own way, and drifted — a
 * status edit left the flag behind, clearing the flag left the status behind — while the
 * one guard that mattered (email send) required *both* before it would refuse.
 *
 * The invariant is now `dnc === (status === 'do_not_call')`, and every write goes through
 * `reconcileDnc` to keep it. Reads go through `isDoNotContact`, which treats either signal
 * as binding: if the two ever disagree again, the answer is "do not contact".
 */
export type ContactStatus = 'new' | 'contacted' | 'qualified' | 'unqualified' | 'do_not_call';

export interface DncState {
  dnc?: boolean | null;
  status?: string | null;
}

/**
 * The status a contact returns to when the flag is lifted.
 *
 * They were reached — that is how they came to be flagged — so `contacted` is the honest
 * description, and it leaves the record somewhere a person will look at it again.
 */
export const DNC_CLEARED_STATUS: ContactStatus = 'contacted';

/** May this person be called, texted or emailed? Either signal alone says no. */
export function isDoNotContact(contact: DncState): boolean {
  return contact.dnc === true || contact.status === 'do_not_call';
}

/** The Mongo condition matching every do-not-contact record, for the same either-signal rule. */
export const DO_NOT_CONTACT_QUERY = { $or: [{ dnc: true }, { status: 'do_not_call' }] };

/**
 * Apply a requested change and return the pair to store.
 *
 * Rules, in order:
 *   1. Asking for do-not-contact by either route sets both. A contradictory request
 *      (`status: 'do_not_call', dnc: false`) resolves to do-not-contact — the safe reading.
 *   2. Moving the status anywhere else lifts the flag: the status *is* the flag.
 *   3. Clearing the flag alone moves a `do_not_call` status to `DNC_CLEARED_STATUS`.
 *   4. No change requested: an already-drifted record heals towards do-not-contact.
 */
export function reconcileDnc(
  current: DncState,
  change: { dnc?: boolean; status?: ContactStatus },
): { dnc: boolean; status: ContactStatus } {
  if (change.dnc === true || change.status === 'do_not_call') {
    return { dnc: true, status: 'do_not_call' };
  }

  if (change.status) return { dnc: false, status: change.status };

  const currentStatus = (current.status ?? 'new') as ContactStatus;

  if (change.dnc === false) {
    return {
      dnc: false,
      status: currentStatus === 'do_not_call' ? DNC_CLEARED_STATUS : currentStatus,
    };
  }

  return isDoNotContact(current)
    ? { dnc: true, status: 'do_not_call' }
    : { dnc: false, status: currentStatus };
}
