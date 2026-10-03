/**
 * Show every membership an email holds, and the role behind each.
 *
 * "Why can this person not do X?" is nearly always a membership pointing at a different
 * role than expected, and that is invisible from the UI.
 *
 *   npm run whoami -- --email someone@example.com
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { Account, Agency, Membership, Role, User } from '../models';

const email = process.argv.find((a) => a.startsWith('--email='))?.split('=')[1]
  ?? process.argv[process.argv.indexOf('--email') + 1];

async function main() {
  if (!email) {
    console.error('Usage: npm run whoami -- --email someone@example.com');
    process.exit(1);
  }

  await mongoose.connect(env.MONGODB_URI);

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }

  console.log(`\n${user.firstName} ${user.lastName} <${user.email}>  status=${user.status}`);

  const memberships = await Membership.find({ userId: String(user._id) });
  console.log(`${memberships.length} membership(s):\n`);

  for (const m of memberships) {
    const [role, agency, account] = await Promise.all([
      Role.findById(m.roleId),
      m.agencyId ? Agency.findById(m.agencyId) : null,
      m.accountId ? Account.findById(m.accountId) : null,
    ]);

    console.log(`  scope     ${m.scope}`);
    console.log(`  status    ${m.status}`);
    console.log(`  role      ${role?.name ?? '(missing)'} [${role?.key ?? '?'}]`);
    console.log(`  agency    ${agency?.name ?? '—'}`);
    console.log(`  account   ${account?.name ?? '—'}`);
    console.log(`  grants    ${role?.permissions.join(', ') ?? '—'}`);
    console.log(`  id        ${String(m._id)}\n`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
