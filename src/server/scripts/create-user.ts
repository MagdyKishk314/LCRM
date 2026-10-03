/**
 * Create a user and attach a membership.
 *
 * The invite endpoint deliberately refuses agency- and platform-scoped roles, because
 * granting those from a sub-account screen would silently hand over every other
 * sub-account. Those memberships are created here instead, where it is an explicit,
 * auditable admin action rather than something a UI can be tricked into.
 *
 * Usage:
 *   npm run create-user -- \
 *     --email a@b.com --password 'secret' --first Ada --last Lovelace \
 *     --scope agency --role agency_owner [--agency landcaller] [--account <id>]
 *
 * Re-running for an existing email updates that user's name and password and reuses
 * the identity, so it doubles as a password reset.
 */
import { SYSTEM_ROLES } from '@/shared';
import { connectDatabase, disconnectDatabase } from '../core/db';
import { Account, Agency, Membership, Role, User, hashPassword } from '../models';

interface Args {
  email: string;
  password: string;
  first: string;
  last: string;
  scope: 'platform' | 'agency' | 'account';
  role: string;
  agency?: string;
  account?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    // Support both `--key value` and `--key=value`.
    if (key.includes('=')) {
      const [k, ...rest] = key.split('=');
      if (k) out[k] = rest.join('=');
    } else if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = 'true';
    }
  }

  const missing = ['email', 'password', 'first', 'last'].filter((k) => !out[k]);
  if (missing.length > 0) {
    console.error(`Missing required flags: ${missing.map((m) => `--${m}`).join(', ')}`);
    process.exit(1);
  }

  const scope = (out.scope ?? 'account') as Args['scope'];
  if (!['platform', 'agency', 'account'].includes(scope)) {
    console.error(`Invalid --scope "${scope}". Use platform, agency or account.`);
    process.exit(1);
  }

  return {
    email: out.email!.toLowerCase(),
    password: out.password!,
    first: out.first!,
    last: out.last!,
    scope,
    role: out.role ?? (scope === 'agency' ? 'agency_owner' : 'account_admin'),
    agency: out.agency,
    account: out.account,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  await connectDatabase();

  // ── Role ──────────────────────────────────────────────────────────────────
  const role = await Role.findOne({ key: args.role, agencyId: null });
  if (!role) {
    const available = SYSTEM_ROLES.map((r) => `${r.key} (${r.scope})`).join(', ');
    console.error(`Role "${args.role}" not found. Run \`npm run seed\` first.\nAvailable: ${available}`);
    process.exit(1);
  }
  if (role.scope !== args.scope) {
    console.error(`Role "${args.role}" is ${role.scope}-scoped but --scope is ${args.scope}.`);
    process.exit(1);
  }

  // ── Tenant ────────────────────────────────────────────────────────────────
  let agencyId: string | undefined;
  let accountId: string | undefined;

  if (args.scope !== 'platform') {
    const agency = args.agency
      ? await Agency.findOne({ $or: [{ slug: args.agency }, { _id: args.agency }] })
      : await Agency.findOne({});

    if (!agency) {
      console.error(
        args.agency
          ? `Agency "${args.agency}" not found.`
          : 'No agency exists yet. Run `npm run seed` first.',
      );
      process.exit(1);
    }
    agencyId = String(agency._id);

    if (args.scope === 'account') {
      const account = args.account
        ? await Account.findOne({ _id: args.account, agencyId })
        : await Account.findOne({ agencyId });
      if (!account) {
        console.error('No sub-account found for that agency. Pass --account <id>.');
        process.exit(1);
      }
      accountId = String(account._id);
    }
  }

  // ── User ──────────────────────────────────────────────────────────────────
  const passwordHash = await hashPassword(args.password);
  const existing = await User.findOne({ email: args.email });

  const user = existing
    ? await User.findOneAndUpdate(
        { email: args.email },
        {
          passwordHash,
          firstName: args.first,
          lastName: args.last,
          status: 'active',
          // Invalidates every refresh token issued before this password change.
          $inc: { tokenVersion: 1 },
        },
        { new: true },
      )
    : await User.create({
        email: args.email,
        passwordHash,
        firstName: args.first,
        lastName: args.last,
        status: 'active',
        mfaEnabled: false,
      });

  if (!user) {
    console.error('Failed to create or update the user.');
    process.exit(1);
  }

  // ── Membership ────────────────────────────────────────────────────────────
  const filter: Record<string, unknown> = { userId: String(user._id), scope: args.scope };
  if (agencyId) filter.agencyId = agencyId;
  if (accountId) filter.accountId = accountId;

  const membership = await Membership.findOneAndUpdate(
    filter,
    {
      ...filter,
      roleId: String(role._id),
      permissionOverrides: { grant: [], deny: [] },
      status: 'active',
    },
    { upsert: true, new: true },
  );

  const scopeLabel =
    args.scope === 'platform'
      ? 'the whole platform'
      : args.scope === 'agency'
        ? `every sub-account under agency ${agencyId}`
        : `sub-account ${accountId}`;

  console.log(`\n[create-user] ${existing ? 'updated' : 'created'} ${user.email}`);
  console.log(`  name       : ${user.firstName} ${user.lastName}`);
  console.log(`  role       : ${role.name} (${role.key})`);
  console.log(`  permissions: ${role.permissions.join(', ')}`);
  console.log(`  access     : ${scopeLabel}`);
  console.log(`  membership : ${String(membership?._id)}`);
  if (existing) console.log('  note       : password replaced; existing sessions revoked');

  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error('[create-user] failed:', err);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
