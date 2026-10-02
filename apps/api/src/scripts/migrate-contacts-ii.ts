/**
 * One-off data migration for Contacts II (Plans/CONTACTS-PLAN.md).
 *
 *   pnpm --filter @landcaller/api migrate:contacts-ii            # report only, writes nothing
 *   pnpm --filter @landcaller/api migrate:contacts-ii -- --apply # make the changes
 *
 * Three steps, each safe to re-run:
 *
 *   1. Contacts: `phoneDigits`, `altPhoneDigits`, `properties` (the single `property`
 *      lifted into the array as the primary parcel) and fresh search tokens. Until this has
 *      run, existing contacts match no phone-based duplicate check and have no parcels.
 *   2. History: the retired `list_added` type becomes `list_change`.
 *   3. Tasks: rows from before `status` existed are marked `open` (or `done` if completed).
 *
 * Run `sync-indexes` first so the new indexes exist before the collection is rewritten.
 * Works on the raw collections: this spans every tenant.
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { Activity, Contact, Task } from '../models';
import { deriveContactFields } from '../modules/contacts/derive';
import { buildSearchTokens } from '../modules/contacts/search';

const APPLY = process.argv.includes('--apply');
const BATCH = 1_000;

async function migrateContacts() {
  const contacts = Contact.collection;
  const pending = {
    $or: [
      { phoneDigits: { $exists: false }, phone: { $exists: true, $nin: [null, ''] } },
      { properties: { $exists: false } },
      { properties: { $size: 0 }, 'property.apn': { $exists: true } },
    ],
  };

  const count = await contacts.countDocuments(pending);
  console.log(`[contacts] ${count} contact(s) to derive phone digits and parcels for`);
  if (!APPLY || count === 0) return;

  let done = 0;
  for (;;) {
    const batch = await contacts
      .find(pending)
      .project({ firstName: 1, lastName: 1, company: 1, email: 1, phone: 1, altPhones: 1, property: 1, properties: 1 })
      .limit(BATCH)
      .toArray();
    if (batch.length === 0) break;

    await contacts.bulkWrite(
      batch.map((c) => {
        const derived = deriveContactFields(c as never);
        return {
          updateOne: {
            filter: { _id: c._id },
            update: {
              $set: {
                phoneDigits: derived.phoneDigits ?? null,
                altPhoneDigits: derived.altPhoneDigits,
                properties: derived.properties,
                property: derived.property ?? null,
                searchTokens: buildSearchTokens({ ...c, ...derived } as never),
              },
            },
          },
        };
      }),
    );

    done += batch.length;
    console.log(`[contacts] ${done} / ${count}`);
    // A contact with no phone and no parcel stays "pending" by the filter above only if
    // `properties` is missing; after the write it exists (possibly empty), so the loop ends.
  }
}

async function migrateHistoryTypes() {
  const activities = Activity.collection;
  const count = await activities.countDocuments({ type: 'list_added' });
  console.log(`[history] ${count} entr${count === 1 ? 'y' : 'ies'} of the retired type list_added`);
  if (APPLY && count > 0) {
    await activities.updateMany({ type: 'list_added' }, { $set: { type: 'list_change' } });
    console.log('[history] renamed to list_change');
  }
}

async function migrateTasks() {
  const tasks = Task.collection;
  const count = await tasks.countDocuments({ status: { $exists: false } });
  console.log(`[tasks] ${count} task(s) without a status`);
  if (APPLY && count > 0) {
    await tasks.updateMany({ status: { $exists: false }, completedAt: { $exists: true, $ne: null } }, { $set: { status: 'done' } });
    await tasks.updateMany({ status: { $exists: false } }, { $set: { status: 'open' } });
    console.log('[tasks] status set');
  }
}

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  console.log(APPLY ? 'Applying changes.\n' : 'Dry run — pass --apply to make changes.\n');

  await migrateContacts();
  await migrateHistoryTypes();
  await migrateTasks();
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => mongoose.disconnect());
