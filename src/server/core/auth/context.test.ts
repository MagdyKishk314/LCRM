import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { Account, Agency, Role } from '../../models';
import { as, startHarness, stopHarness, type World } from '../../test/harness';
import { signContextToken, verifyContextToken, type ContextClaims } from './context-token';

let world: World;

before(async () => {
  world = await startHarness();
});
after(stopHarness);

/** Enter a context as `user`, returning the token the API issued. */
async function enter(user: { token: string }, body: Record<string, unknown>) {
  const res = await as(user).post('/core/auth/context').send(body);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { token: string | null; scope: string; accountId: string | null };
}

const withContext = (user: { token: string }, accountId: string | undefined, token: string) => {
  const client = as(user, accountId);
  return {
    get: (path: string) => client.get(path).set('X-Context', token),
    patch: (path: string) => client.patch(path).set('X-Context', token),
  };
};

// â”€â”€ Issuing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('entering a sub-account settles the seat into a signed token', async () => {
  const { A1 } = world.accounts;
  const grant = await enter(world.users.adminA1, { type: 'account', accountId: A1 });

  assert.equal(grant.scope, 'account');
  assert.equal(grant.accountId, A1);

  const claims = verifyContextToken(grant.token!);
  assert.ok(claims);
  assert.equal(claims.sub, world.users.adminA1.id);
  assert.equal(claims.agencyId, world.agencies.A);
  assert.ok(claims.permissions.includes('core:settings:update'));
  assert.ok(claims.modules.includes('contacts'));
});

test('an agency owner entering a sub-account gets an agency token that is not pinned to it', async () => {
  const grant = await enter(world.users.ownerA, { type: 'account', accountId: world.accounts.A1 });

  assert.equal(grant.scope, 'agency');
  assert.equal(grant.accountId, null);
});

test('a sub-account the user is not a member of issues nothing', async () => {
  const res = await as(world.users.adminA1)
    .post('/core/auth/context')
    .send({ type: 'account', accountId: world.accounts.A2 });
  assert.equal(res.status, 403);
});

test('an account-scoped user cannot enter the agency console', async () => {
  const res = await as(world.users.adminA1).post('/core/auth/context').send({ type: 'agency' });
  assert.equal(res.status, 403);
});

test('a suspended agency is refused at the door', async () => {
  const { B } = world.agencies;
  await Agency.updateOne({ _id: B }, { status: 'suspended' });
  try {
    const res = await as(world.users.ownerB).post('/core/auth/context').send({ type: 'agency' });
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /suspended/);
  } finally {
    await Agency.updateOne({ _id: B }, { status: 'active' });
  }
});

// â”€â”€ Presenting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

test('a request with a context token is served with the permissions it carries', async () => {
  const { A1 } = world.accounts;
  const { token } = await enter(world.users.adminA1, { type: 'account', accountId: A1 });

  const res = await withContext(world.users.adminA1, A1, token!)
    .patch(`/core/accounts/${A1}`)
    .send({ timezone: 'America/Denver' });
  assert.equal(res.status, 200);
  assert.equal(res.body.timezone, 'America/Denver');
});

test('a token for one sub-account grants nothing in another', async () => {
  const { A1, A2 } = world.accounts;
  const { token } = await enter(world.users.adminA1, { type: 'account', accountId: A1 });

  // Presented against A2, where adminA1 holds no seat: the token does not apply, and the
  // long way round finds no membership either.
  const res = await withContext(world.users.adminA1, A2, token!).get(`/core/accounts/${A2}`);
  assert.equal(res.status, 403);
});

test("a token issued to someone else is ignored, not honoured", async () => {
  const { A1 } = world.accounts;
  const { token } = await enter(world.users.adminA1, { type: 'account', accountId: A1 });

  // callerA1 presents the admin's token. It names a different `sub`, so it is set aside and
  // the caller is resolved from their own seat â€” which cannot edit the account.
  const res = await withContext(world.users.callerA1, A1, token!)
    .patch(`/core/accounts/${A1}`)
    .send({ timezone: 'America/Denver' });
  assert.equal(res.status, 403);
});

test('a forged token is ignored', async () => {
  const { A1 } = world.accounts;
  const claims: ContextClaims = {
    sub: world.users.callerA1.id,
    kind: 'ctx',
    scope: 'account',
    agencyId: world.agencies.A,
    accountId: A1,
    modules: ['core', 'contacts'],
    permissions: ['*'],
  };
  const forged = jwt.sign(claims, 'not-the-server-secret', { expiresIn: 600 });

  const res = await withContext(world.users.callerA1, A1, forged)
    .patch(`/core/accounts/${A1}`)
    .send({ timezone: 'America/Denver' });
  assert.equal(res.status, 403);
});

test('an expired token falls back to resolving the seat', async () => {
  const { A1 } = world.accounts;
  const claims: ContextClaims = {
    sub: world.users.adminA1.id,
    kind: 'ctx',
    scope: 'account',
    agencyId: world.agencies.A,
    accountId: A1,
    modules: [],
    permissions: [],
  };
  const expired = jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: -1 });

  // Were the expired token honoured, its empty permission set would refuse this.
  const res = await withContext(world.users.adminA1, A1, expired)
    .patch(`/core/accounts/${A1}`)
    .send({ timezone: 'America/Denver' });
  assert.equal(res.status, 200);
});

test("the sub-account's own module toggles still apply on every request", async () => {
  const { A1 } = world.accounts;
  const { token } = await enter(world.users.adminA1, { type: 'account', accountId: A1 });

  const before = await withContext(world.users.adminA1, A1, token!).get('/email/templates');
  assert.equal(before.status, 200);

  // Switch email off for A1 directly; the token predates the change. (Contacts and
  // pipelines are core modules and cannot be switched off.)
  await Account.updateOne({ _id: A1 }, { enabledModules: ['core', 'contacts', 'pipelines'] });
  try {
    const after = await withContext(world.users.adminA1, A1, token!).get('/email/templates');
    assert.equal(after.status, 403);
  } finally {
    await Account.updateOne({ _id: A1 }, { enabledModules: ['core', 'contacts', 'pipelines', 'email'] });
  }
});

test('a role change reaches a session when its token is reissued, not before', async () => {
  const { A1 } = world.accounts;
  const roleId = world.roles.account_admin;
  const original = (await Role.findById(roleId))!.permissions;

  const { token: before } = await enter(world.users.adminA1, { type: 'account', accountId: A1 });

  await Role.updateOne({ _id: roleId }, { permissions: ['contacts:*'] });
  try {
    // The old token still carries the old answer...
    const stale = await withContext(world.users.adminA1, A1, before!)
      .patch(`/core/accounts/${A1}`)
      .send({ timezone: 'America/Denver' });
    assert.equal(stale.status, 200);

    // ...and a reissued one carries the new.
    const { token: after } = await enter(world.users.adminA1, { type: 'account', accountId: A1 });
    const fresh = await withContext(world.users.adminA1, A1, after!)
      .patch(`/core/accounts/${A1}`)
      .send({ timezone: 'America/Denver' });
    assert.equal(fresh.status, 403);
  } finally {
    await Role.updateOne({ _id: roleId }, { permissions: original });
  }
});

test('the agency console is served from an agency token', async () => {
  const { token } = await enter(world.users.ownerA, { type: 'agency' });
  const res = await as(world.users.ownerA).get('/core/agency/overview').set('X-Context', token!);
  assert.equal(res.status, 200);
  assert.equal(res.body.agency.id, world.agencies.A);
});

test('signing and verifying round-trips the claims', () => {
  const claims: ContextClaims = {
    sub: 'u1',
    kind: 'ctx',
    scope: 'agency',
    agencyId: 'ag1',
    modules: ['core'],
    permissions: ['*'],
    hint: 'agency',
  };
  const verified = verifyContextToken(signContextToken(claims));
  assert.ok(verified);
  assert.equal(verified.hint, 'agency');
  assert.equal(verifyContextToken('agency'), null);
  assert.equal(verifyContextToken(undefined), null);
});
