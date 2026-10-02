/**
 * Verify the credential invariants on User against a real database.
 *
 * Three of these cannot be checked without Mongo: the sparse unique index on
 * `identities`, whether a provider-only user can be saved now that `passwordHash` is
 * optional, and whether users *without* identities still save — a unique index on an array
 * field is the kind of thing that either allows duplicates or blocks everyone, and the
 * difference does not show up in a type.
 *
 *   pnpm --filter @landcaller/api check:identities
 */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { User } from '../models';

let failures = 0;

function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  await User.syncIndexes();

  const salt = Date.now().toString(36);
  const email = (n: string) => `identity-${salt}-${n}@landcaller.test`;

  // 1. A provider-only user is valid: no password, one identity.
  let providerOnly;
  try {
    providerOnly = await User.create({
      email: email('google'),
      firstName: 'Provider',
      lastName: 'Only',
      status: 'active',
      identities: [{ provider: 'google', subject: `sub-${salt}-1`, email: email('google') }],
    });
    check('a provider-only user saves without a password', true);
  } catch (err) {
    check('a provider-only user saves without a password', false, String(err).slice(0, 120));
  }

  // 2. An active user with neither credential is refused.
  try {
    await User.create({
      email: email('nothing'),
      firstName: 'No',
      lastName: 'Credentials',
      status: 'active',
    });
    check('an active user with no credential is refused', false, 'it saved');
  } catch (err) {
    check('an active user with no credential is refused', /password or a linked/.test(String(err)));
  }

  // 3. An invited user is exempt — having neither yet is the point of an invite.
  try {
    await User.create({
      email: email('invited'),
      firstName: 'Pending',
      lastName: 'Invite',
      status: 'invited',
    });
    check('an invited user may have neither yet', true);
  } catch (err) {
    check('an invited user may have neither yet', false, String(err).slice(0, 120));
  }

  // 4. Two users cannot claim the same Google account.
  try {
    await User.create({
      email: email('dupe'),
      firstName: 'Duplicate',
      lastName: 'Identity',
      status: 'active',
      identities: [{ provider: 'google', subject: `sub-${salt}-1`, email: email('dupe') }],
    });
    check('one Google account cannot be linked to two users', false, 'the duplicate saved');
  } catch (err) {
    check('one Google account cannot be linked to two users', /duplicate key/i.test(String(err)));
  }

  // 5. The sparse index must not collide users who have no identities at all.
  try {
    await User.create({
      email: email('pw-a'),
      firstName: 'Password',
      lastName: 'One',
      status: 'active',
      passwordHash: 'x'.repeat(60),
    });
    await User.create({
      email: email('pw-b'),
      firstName: 'Password',
      lastName: 'Two',
      status: 'active',
      passwordHash: 'y'.repeat(60),
    });
    check('users without identities do not collide on the sparse index', true);
  } catch (err) {
    check('users without identities do not collide on the sparse index', false, String(err).slice(0, 160));
  }

  // 6. verifyPassword on a provider-only user answers false without throwing.
  if (providerOnly) {
    const withHash = await User.findById(providerOnly._id).select('+passwordHash');
    try {
      const ok = await (withHash as any).verifyPassword('anything-at-all');
      check('verifying a password against a provider-only user returns false', ok === false);
    } catch (err) {
      check('verifying a password against a provider-only user returns false', false, String(err).slice(0, 120));
    }
  }

  // 7. Unlinking the last identity from a provider-only user is refused by the model.
  if (providerOnly) {
    try {
      const doc = await User.findById(providerOnly._id);
      doc!.set('identities', []);
      await doc!.save();
      check('the model refuses to leave an account with no way in', false, 'it saved');
    } catch (err) {
      check('the model refuses to leave an account with no way in', /password or a linked/.test(String(err)));
    }
  }

  await User.deleteMany({ email: new RegExp(`^identity-${salt}-`) });
  console.log(`\n${failures === 0 ? 'credential invariants hold' : failures + ' FAILED'}`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
