import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startHarness, stopHarness, type World } from '../../test/harness';
import { Membership } from '../../models';

let world: World;

before(async () => {
  world = await startHarness();
});
after(stopHarness);

test('one person can hold an agency seat in two agencies', async () => {
  // ownerA already holds an agency membership in A.
  await Membership.create({
    userId: world.users.ownerA.id,
    scope: 'agency',
    agencyId: world.agencies.B,
    roleId: world.roles.agency_user,
    status: 'active',
  });

  const seats = await Membership.find({ userId: world.users.ownerA.id, scope: 'agency' });
  assert.equal(seats.length, 2);
});

test('a second agency seat in the same agency is refused', async () => {
  await assert.rejects(
    Membership.create({
      userId: world.users.ownerB.id,
      scope: 'agency',
      agencyId: world.agencies.B,
      roleId: world.roles.agency_user,
      status: 'active',
    }),
    /duplicate key/,
  );
});

test('a second seat on the same sub-account is refused', async () => {
  await assert.rejects(
    Membership.create({
      userId: world.users.adminA1.id,
      scope: 'account',
      agencyId: world.agencies.A,
      accountId: world.accounts.A1,
      roleId: world.roles.caller,
      status: 'active',
    }),
    /duplicate key/,
  );
});
