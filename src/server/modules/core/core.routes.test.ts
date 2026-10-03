import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { hasPermission, permissionVocabulary, resolvePermissions, systemRole } from '@/shared';
import {
  PASSWORD,
  anon,
  as,
  inAccount,
  startHarness,
  stopHarness,
  type World,
} from '../../test/harness';
import { signAccessToken } from '../../core/auth/jwt';
import { Account, AuditLog, Contact, Membership, Opportunity, Pipeline, Role, User } from '../../models';

let world: World;

before(async () => {
  world = await startHarness();
});
after(stopHarness);

// ── FIX-01 · acting on a sibling sub-account ────────────────────────────────

test('a sub-account admin cannot edit a sibling sub-account', async () => {
  const { A1, A2 } = world.accounts;

  const res = await as(world.users.adminA1, A1)
    .patch(`/core/accounts/${A2}`)
    .send({ name: 'Renamed by a stranger' });
  assert.equal(res.status, 404);

  const sibling = await Account.findById(A2);
  assert.equal(sibling?.name, 'Account A2');
});

test('a sub-account admin can still edit their own sub-account', async () => {
  const { A1 } = world.accounts;

  const res = await as(world.users.adminA1, A1)
    .patch(`/core/accounts/${A1}`)
    .send({ markets: ['Costilla County, CO'] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.markets, ['Costilla County, CO']);
});

test('an agency owner keeps their reach across sub-accounts', async () => {
  const { A1, A2 } = world.accounts;

  // Permissions resolved in A1, acting on A2: exactly what is refused for an account admin.
  const res = await as(world.users.ownerA, A1)
    .patch(`/core/accounts/${A2}`)
    .send({ timezone: 'America/Chicago' });
  assert.equal(res.status, 200);
});

test("another agency's sub-account is not reachable by id", async () => {
  const res = await as(world.users.ownerB, world.accounts.B1)
    .patch(`/core/accounts/${world.accounts.A1}`)
    .send({ name: 'Cross-agency' });
  assert.equal(res.status, 404);
});

test('module toggles are held to the same target rule', async () => {
  // Granted directly, since no built-in account role carries the toggle permission.
  await Membership.updateOne(
    { userId: world.users.adminA1.id },
    { $set: { 'permissionOverrides.grant': ['core:module:toggle'] } },
  );

  const res = await as(world.users.adminA1, world.accounts.A1)
    .put(`/core/accounts/${world.accounts.A2}/modules`)
    .send({ enabledModules: [] });
  assert.equal(res.status, 404);

  const sibling = await Account.findById(world.accounts.A2);
  assert.ok(sibling?.enabledModules.includes('email'), 'sibling modules untouched');

  await Membership.updateOne(
    { userId: world.users.adminA1.id },
    { $set: { 'permissionOverrides.grant': [] } },
  );
});

// ── FIX-02 · audit entries with no actor ────────────────────────────────────

test('an audit entry can be recorded with nobody signed in', async () => {
  const entry = await AuditLog.create({
    agencyId: 'system',
    action: 'auth.google.refused',
    entity: 'User',
    entityId: 'unknown',
    after: { email: 'stranger@example.com', reason: 'no_matching_user' },
  });
  assert.ok(entry._id);
});

// ── FIX-05 · sign-in hardening ──────────────────────────────────────────────

async function login(email: string, password = PASSWORD) {
  return anon().post('/api/v1/core/auth/login').send({ email, password });
}

function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const cookies = ([] as string[]).concat((res.headers['set-cookie'] as string[]) ?? []);
  const found = cookies.find((c) => c.startsWith('lc_refresh='));
  assert.ok(found, 'login sets a refresh cookie');
  return decodeURIComponent(found.split(';')[0]!.slice('lc_refresh='.length));
}

const refresh = (refreshToken: string) =>
  anon().post('/api/v1/core/auth/refresh').send({ refreshToken });

test('signing out kills the refresh token, not just the cookie', async () => {
  const signedIn = await login(world.users.userA1.email);
  assert.equal(signedIn.status, 200);
  const token = refreshCookie(signedIn);

  assert.equal((await refresh(token)).status, 200);

  const out = await anon().post('/api/v1/core/auth/logout').send({ refreshToken: token });
  assert.equal(out.status, 200);

  assert.equal((await refresh(token)).status, 401);
});

test('signing out with a stale token does not end a newer session', async () => {
  const first = refreshCookie(await login(world.users.adminA2.email));
  await anon().post('/api/v1/core/auth/logout').send({ refreshToken: first });

  const second = refreshCookie(await login(world.users.adminA2.email));
  // Replaying the dead token must not bump the version again.
  await anon().post('/api/v1/core/auth/logout').send({ refreshToken: first });

  assert.equal((await refresh(second)).status, 200);
});

test('signing out with no token still succeeds', async () => {
  const res = await anon().post('/api/v1/core/auth/logout').send({});
  assert.equal(res.status, 200);
});

test('a suspended user cannot refresh', async () => {
  const token = refreshCookie(await login(world.users.adminB1.email));

  await User.updateOne({ _id: world.users.adminB1.id }, { $set: { status: 'suspended' } });
  assert.equal((await refresh(token)).status, 401);

  await User.updateOne({ _id: world.users.adminB1.id }, { $set: { status: 'active' } });
});

test('repeated wrong passwords for one account are cut off', async () => {
  const email = world.users.callerA1.email;

  // The counter is a fixed 15-minute window. Eleven bcrypt comparisons take several
  // seconds, so a run that starts just before a window closes would split its attempts
  // across two counters; wait the boundary out rather than fail one run in a hundred.
  const WINDOW = 15 * 60_000;
  const untilBoundary = WINDOW - (Date.now() % WINDOW);
  if (untilBoundary < 20_000) await new Promise((r) => setTimeout(r, untilBoundary + 500));

  for (let i = 0; i < 10; i++) {
    const res = await login(email, 'wrong-password');
    assert.equal(res.status, 401, `attempt ${i + 1}`);
  }

  const blocked = await login(email, 'wrong-password');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');

  // The right password does not get through either — that is the point of the limit.
  assert.equal((await login(email)).status, 429);

  // And it is per account: someone else signs in normally.
  assert.equal((await login(world.users.ownerB.email)).status, 200);
});

// ── FIX-06 · changing the role on a membership ──────────────────────────────

test("another agency's custom role cannot be assigned", async () => {
  const foreign = await Role.create({
    agencyId: world.agencies.B,
    key: 'custom_b_only',
    name: 'B only',
    scope: 'account',
    permissions: ['contacts:contact:read'],
  });
  const membership = await Membership.findOne({ userId: world.users.userA1.id });

  const res = await as(world.users.ownerA)
    .patch(`/core/agency/memberships/${membership!._id}`)
    .send({ roleId: String(foreign._id) });
  assert.equal(res.status, 403);

  const after = await Membership.findById(membership!._id);
  assert.equal(after?.roleId, world.roles.account_user);
});

test('a system role can be assigned', async () => {
  const membership = await Membership.findOne({ userId: world.users.userA1.id });

  const res = await as(world.users.ownerA)
    .patch(`/core/agency/memberships/${membership!._id}`)
    .send({ roleId: world.roles.caller });
  assert.equal(res.status, 200);

  await Membership.updateOne({ _id: membership!._id }, { $set: { roleId: world.roles.account_user } });
});

test('you cannot suspend your own agency access', async () => {
  const own = await Membership.findOne({ userId: world.users.ownerA.id, scope: 'agency' });

  const res = await as(world.users.ownerA)
    .patch(`/core/agency/memberships/${own!._id}`)
    .send({ status: 'suspended' });
  assert.equal(res.status, 400);
});

// ── FIX-08 · account status ─────────────────────────────────────────────────

test('a paused sub-account is closed to its members and open to the agency', async () => {
  const { A2 } = world.accounts;
  const member = as(world.users.adminA2, A2);
  const owner = as(world.users.ownerA, A2);

  assert.equal((await member.get('/contacts')).status, 200);

  const paused = await owner.patch(`/core/accounts/${A2}`).send({ status: 'paused' });
  assert.equal(paused.status, 200);

  // Straight away: the write evicts the cached account on this instance.
  const blocked = await member.get('/contacts');
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error.message, /paused/);

  assert.equal((await owner.get('/contacts')).status, 200);

  // Not offered as a destination either.
  const session = await as(world.users.adminA2).get(`/core/auth/session?accountId=${A2}`);
  assert.equal(session.status, 403);

  const resumed = await owner.patch(`/core/accounts/${A2}`).send({ status: 'active' });
  assert.equal(resumed.status, 200);
  assert.equal((await member.get('/contacts')).status, 200);
});

test('a member cannot change the status of their own sub-account', async () => {
  const { A1 } = world.accounts;

  const res = await as(world.users.adminA1, A1)
    .patch(`/core/accounts/${A1}`)
    .send({ status: 'archived' });
  assert.equal(res.status, 403);

  assert.equal((await Account.findById(A1))?.status, 'active');
});

// ── FIX-21 · custom roles ───────────────────────────────────────────────────

test('an agency owner can create, edit and delete a custom role', async () => {
  const owner = as(world.users.ownerA, world.accounts.A1);

  const created = await owner.post('/core/roles').send({
    name: 'Closer',
    description: 'Works offers through to contract.',
    scope: 'account',
    permissions: ['contacts:contact:read', 'pipelines:opportunity:read'],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.key, 'custom_closer');
  assert.equal(created.body.agencyId, world.agencies.A);
  assert.equal(created.body.isSystem, false);

  const edited = await owner
    .patch(`/core/roles/${created.body.id}`)
    .send({ permissions: ['contacts:contact:read'] });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.permissions, ['contacts:contact:read']);

  // Visible to its own agency, invisible to the other.
  const mine = await owner.get('/core/roles');
  assert.ok(mine.body.data.some((r: { id: string }) => r.id === created.body.id));
  const theirs = await as(world.users.ownerB, world.accounts.B1).get('/core/roles');
  assert.ok(!theirs.body.data.some((r: { id: string }) => r.id === created.body.id));

  // Another agency cannot edit it.
  const foreign = await as(world.users.ownerB, world.accounts.B1)
    .patch(`/core/roles/${created.body.id}`)
    .send({ name: 'Hijacked' });
  assert.equal(foreign.status, 404);

  // Held by someone: refuse to delete.
  const holder = await Membership.findOne({ userId: world.users.callerA1.id });
  await Membership.updateOne({ _id: holder!._id }, { $set: { roleId: created.body.id } });
  assert.equal((await owner.delete(`/core/roles/${created.body.id}`)).status, 409);

  await Membership.updateOne({ _id: holder!._id }, { $set: { roleId: world.roles.caller } });
  assert.equal((await owner.delete(`/core/roles/${created.body.id}`)).status, 204);
});

test('built-in roles cannot be edited or deleted', async () => {
  const owner = as(world.users.ownerA, world.accounts.A1);

  assert.equal(
    (await owner.patch(`/core/roles/${world.roles.caller}`).send({ permissions: [] })).status,
    403,
  );
  assert.equal((await owner.delete(`/core/roles/${world.roles.caller}`)).status, 403);
});

test('unknown permissions are refused', async () => {
  const res = await as(world.users.ownerA, world.accounts.A1)
    .post('/core/roles')
    .send({ name: 'Typo', scope: 'account', permissions: ['contacts:contact:reed'] });
  assert.equal(res.status, 400);
});

test('a sub-account admin cannot manage roles', async () => {
  const res = await as(world.users.adminA1, world.accounts.A1)
    .post('/core/roles')
    .send({ name: 'Mine', scope: 'account', permissions: ['contacts:contact:read'] });
  assert.equal(res.status, 403);
});

test('nobody can build a role stronger than themselves', async () => {
  // An agency admin holds a great deal, but not everything.
  const admin = await User.create({
    email: 'agency-admin-a@example.com',
    passwordHash: 'x',
    firstName: 'Agency',
    lastName: 'Admin',
    status: 'active',
  });
  await Membership.create({
    userId: String(admin._id),
    scope: 'agency',
    agencyId: world.agencies.A,
    roleId: world.roles.agency_admin,
    status: 'active',
  });
  const token = signAccessToken({ sub: String(admin._id), email: admin.email });

  const held = resolvePermissions({ rolePermissions: systemRole('agency_admin')!.permissions });
  const beyond = permissionVocabulary().find((p) => !hasPermission(held, p));
  assert.ok(beyond, 'the catalog has a permission an agency admin lacks');

  const client = as({ token }, world.accounts.A1);

  const refused = await client
    .post('/core/roles')
    .send({ name: 'Too strong', scope: 'account', permissions: [beyond] });
  assert.equal(refused.status, 403);
  assert.match(refused.body.error.message, /do not hold/);

  const allowed = await client
    .post('/core/roles')
    .send({ name: 'Within reach', scope: 'account', permissions: ['contacts:contact:read'] });
  assert.equal(allowed.status, 201);
});

// ── FIX-16 / FIX-17 · dashboard totals ──────────────────────────────────────

test('the dashboard sums open opportunities per stage, for this sub-account only', async () => {
  const seed = (agency: 'A' | 'B', account: 'A1' | 'B1', values: number[]) =>
    inAccount(world, agency, account, async () => {
      const pipeline = await Pipeline.create({
        name: 'Acquisition',
        isDefault: true,
        stages: [
          { id: 'lead', name: 'Lead', order: 0, probability: 10 },
          { id: 'offer', name: 'Offer', order: 1, probability: 50 },
        ],
      });
      const contact = await Contact.create({ firstName: 'Dash', lastName: 'Board' });

      const card = (stageId: string, value: number, status = 'open') => ({
        pipelineId: String(pipeline._id),
        stageId,
        contactId: String(contact._id),
        name: `${stageId} ${value}`,
        value,
        status,
      });

      await Opportunity.create([
        ...values.map((v) => card('lead', v)),
        card('offer', 1_000),
        card('offer', 9_999, 'lost'),
      ]);
    });

  await seed('A', 'A1', [100, 200]);
  await seed('B', 'B1', [50_000]);

  const res = await as(world.users.adminA1, world.accounts.A1).get('/core/dashboard');
  assert.equal(res.status, 200);

  const { pipeline } = res.body;
  assert.deepEqual(
    pipeline.stages.map((s: { id: string; count: number; value: number }) => [s.id, s.count, s.value]),
    [
      ['lead', 2, 300],
      ['offer', 1, 1_000],
    ],
  );
  assert.equal(pipeline.openCount, 3);
  assert.equal(pipeline.openValue, 1_300);
  assert.equal(pipeline.weightedValue, 530); // 300 × 10% + 1,000 × 50%
});
