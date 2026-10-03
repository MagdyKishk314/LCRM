import mongoose from 'mongoose';
import { Activity, Appointment, Contact, Opportunity, Task } from '../../models';

/**
 * Deleting contacts, and everything that only exists because of them.
 *
 * A contact's timeline and its opportunities are meaningless without it. They used to be
 * left behind: the board showed cards belonging to nobody, the dashboard kept counting
 * their value, and the rows could never be reached again to clean up. List membership
 * needs nothing here — it lives on the contact and goes with it.
 *
 * Sent email is deliberately kept. It is a record of what the business sent, not a
 * property of the contact, and it still reads correctly by recipient address.
 *
 * Done in batches, each in its own transaction. One transaction for the whole delete would
 * be the tidy answer and cannot work: "delete everything matching this filter" may be
 * hundreds of thousands of contacts, past both the transaction time limit and what an
 * `$in` can carry. Within a batch the children go first and the contacts last, all or
 * nothing — so an interrupted delete leaves fewer contacts, never orphans, and running it
 * again finishes the job.
 */
const BATCH = 2_000;

export interface DeleteCounts {
  contacts: number;
  activities: number;
  opportunities: number;
}

export async function deleteContacts(query: Record<string, unknown>): Promise<DeleteCounts> {
  const totals: DeleteCounts = { contacts: 0, activities: 0, opportunities: 0 };

  for (;;) {
    // The tenancy plugin scopes this, so ids from another sub-account never reach the batch.
    const batch = await Contact.find(query).select('_id').limit(BATCH).lean();
    if (batch.length === 0) break;

    const ids = batch.map((c) => String(c._id));
    let removed: DeleteCounts = { contacts: 0, activities: 0, opportunities: 0 };

    await mongoose.connection.transaction(async (session) => {
      // Sequential on purpose: a session runs one operation at a time.
      const activities = await Activity.deleteMany({ contactId: { $in: ids } }, { session });
      const opportunities = await Opportunity.deleteMany(
        { contactId: { $in: ids } },
        { session },
      );
      // Tasks and appointments are about the contact and go with it; sent email stays.
      await Task.deleteMany({ contactId: { $in: ids } }, { session });
      await Appointment.deleteMany({ contactId: { $in: ids } }, { session });
      const contacts = await Contact.deleteMany({ _id: { $in: ids } }, { session });

      // Assigned, not accumulated: the driver may run this callback again on a transient
      // error, and only the attempt that commits should count.
      removed = {
        contacts: contacts.deletedCount ?? 0,
        activities: activities.deletedCount ?? 0,
        opportunities: opportunities.deletedCount ?? 0,
      };
    });

    totals.contacts += removed.contacts;
    totals.activities += removed.activities;
    totals.opportunities += removed.opportunities;

    // Matched but nothing deleted means the next pass would find the same rows forever.
    if (removed.contacts === 0) break;
  }

  return totals;
}
