/**
 * One-off data migration for the fix plan (Plans/FIX-PLAN.md).
 *
 *   npm run migrate:fix-plan            # report only, writes nothing
 *   npm run migrate:fix-plan -- --apply # make the changes
 *
 * Three steps, each safe to re-run:
 *
 *   1. Do-not-contact (FIX-04). Contacts whose `dnc` flag and `do_not_call` status disagree
 *      are set to do-not-contact on both. Where the two disagree the safe reading is that
 *      someone asked not to be contacted.
 *   2. List membership (FIX-11). Static lists kept their members as an id array on the list;
 *      membership now lives on each contact as `listIds`. Copied across, then the array is
 *      removed from the list.
 *   3. Search tokens (FIX-15). Every contact gets the `searchTokens` that search now reads.
 *      Until this has run, existing contacts cannot be found by searching.
 *
 * Run `sync-indexes` first so the new indexes exist before the collection is rewritten.
 *
 * Works on the raw collections: this spans every tenant, and the fields it migrates away
 * from are no longer in the schemas.
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { Contact, ContactList } from '../models';
import { buildSearchTokens } from '../modules/contacts/search';

const APPLY = process.argv.includes('--apply');
const BATCH = 1_000;

async function reconcileDnc() {
  const contacts = Contact.collection;
  const drifted = {
    $or: [
      { dnc: true, status: { $ne: 'do_not_call' } },
      { status: 'do_not_call', dnc: { $ne: true } },
    ],
  };

  const count = await contacts.countDocuments(drifted);
  console.log(`[dnc] ${count} contact(s) where the flag and the status disagree`);

  if (APPLY && count > 0) {
    const result = await contacts.updateMany(drifted, {
      $set: { dnc: true, status: 'do_not_call' },
    });
    console.log(`[dnc] set ${result.modifiedCount} to do-not-contact`);
  }
}

async function migrateListMembers() {
  const lists = ContactList.collection;
  const contacts = Contact.collection;

  const cursor = lists.find({ memberIds: { $exists: true } });
  let listCount = 0;
  let memberCount = 0;

  for await (const list of cursor) {
    const ids: string[] = Array.isArray(list.memberIds) ? list.memberIds : [];
    listCount++;
    memberCount += ids.length;

    if (!APPLY) continue;

    for (let i = 0; i < ids.length; i += BATCH) {
      const objectIds = ids
        .slice(i, i + BATCH)
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      // Pinned to the list's own sub-account: a stray id from elsewhere must not be
      // written into another tenant's contact.
      await contacts.updateMany(
        { _id: { $in: objectIds }, agencyId: list.agencyId, accountId: list.accountId },
        { $addToSet: { listIds: String(list._id) } },
      );
    }

    // Only once every member has been copied, so an interrupted run resumes cleanly.
    await lists.updateOne({ _id: list._id }, { $unset: { memberIds: '', memberCount: '' } });
  }

  console.log(`[lists] ${listCount} list(s) holding ${memberCount} member id(s)`);
  if (APPLY && listCount > 0) console.log('[lists] membership moved onto contacts');
}

async function backfillSearchTokens() {
  const contacts = Contact.collection;
  const missing = { searchTokens: { $exists: false } };

  const count = await contacts.countDocuments(missing);
  console.log(`[search] ${count} contact(s) without search tokens`);
  if (!APPLY || count === 0) return;

  let done = 0;
  for (;;) {
    const batch = await contacts
      .find(missing)
      .project({ firstName: 1, lastName: 1, company: 1, email: 1, phone: 1, altPhones: 1, 'property.apn': 1 })
      .limit(BATCH)
      .toArray();
    if (batch.length === 0) break;

    await contacts.bulkWrite(
      batch.map((contact) => ({
        updateOne: {
          filter: { _id: contact._id },
          update: { $set: { searchTokens: buildSearchTokens(contact) } },
        },
      })),
    );

    done += batch.length;
    console.log(`[search] ${done} / ${count}`);
  }
}

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  console.log(APPLY ? 'Applying changes.\n' : 'Dry run — pass --apply to make changes.\n');

  await reconcileDnc();
  await migrateListMembers();
  await backfillSearchTokens();
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
