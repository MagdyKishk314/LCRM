/**
 * Remove test data on the reserved `@landcaller.test` domain.
 *
 * Invite-flow verification creates real users, and leaving them behind means a sub-account
 * whose people list is half test data. Scoped to a domain no real user can hold, and it
 * prints what it removed rather than deleting silently.
 *
 *   npm run cleanup:test-users
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { AuditLog, Contact, Membership, User } from '../models';

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  // Import verification writes contacts, not just users.
  const contacts = await Contact.deleteMany({ email: /@landcaller\.test$/i }).setOptions({ bypassTenantScope: true });
  if (contacts.deletedCount > 0) console.log(`contacts ${contacts.deletedCount}`);

  const users = await User.find({ email: /@landcaller\.test$/i });
  if (users.length === 0) {
    console.log('No test users found.');
    return;
  }

  const ids = users.map((u) => String(u._id));
  const emails = users.map((u) => u.email);

  console.log(`Removing ${users.length} test user(s):`);
  for (const u of users) console.log(`  ${u.email}  status=${u.status}`);

  const memberships = await Membership.deleteMany({ userId: { $in: ids } });
  const audits = await AuditLog.deleteMany({ 'after.email': { $in: emails } });
  const removed = await User.deleteMany({ _id: { $in: ids } });

  console.log(
    `\nusers ${removed.deletedCount}  memberships ${memberships.deletedCount}  audit ${audits.deletedCount}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
