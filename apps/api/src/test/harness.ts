import './env';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import request from 'supertest';
import { SYSTEM_ROLES } from '@landcaller/shared';
import { createApp } from '../app';
import { env } from '../config/env';
import { signAccessToken } from '../core/auth/jwt';
import { connectDatabase, disconnectDatabase } from '../core/db';
import { runInTenantContext, type TenantContext } from '../core/tenancy/context';
import { Account, Agency, Membership, Plan, Role, User, hashPassword } from '../models';

/**
 * Route-level test harness.
 *
 * Boots the real `createApp()` against an in-memory MongoDB, so a test exercises the whole
 * guard chain — authenticate, resolveTenant, the module gate, the permission gate and the
 * tenancy plugin — rather than a handler in isolation. A replica set rather than a bare
 * mongod, because contact deletion runs in a transaction.
 *
 * The world it seeds is two agencies, because isolation cannot be shown with one: every
 * security test is "someone from over there attempts something over here".
 *
 *   Agency A ── A1 (all modules) ── adminA1, userA1, callerA1
 *            └─ A2 (all modules) ── adminA2
 *            ownerA (agency owner)
 *   Agency B ── B1 ── adminB1
 *            ownerB (agency owner)
 */
export const PASSWORD = 'Correct-Horse-Battery-9';

type UserKey =
  | 'ownerA'
  | 'adminA1'
  | 'userA1'
  | 'callerA1'
  | 'adminA2'
  | 'ownerB'
  | 'adminB1';

export interface World {
  planId: string;
  agencies: { A: string; B: string };
  accounts: { A1: string; A2: string; B1: string };
  roles: Record<string, string>;
  users: Record<UserKey, { id: string; email: string; token: string }>;
}

let replset: MongoMemoryReplSet | undefined;

export const app = createApp();

export async function startHarness(): Promise<World> {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  env.MONGODB_URI = replset.getUri('landcaller-test');
  await connectDatabase();

  // Unique indexes are part of what is under test, so wait for them to exist.
  for (const model of Object.values(mongoose.models)) await model.init();

  return seedWorld();
}

export async function stopHarness(): Promise<void> {
  await disconnectDatabase();
  await replset?.stop();
}

async function seedWorld(): Promise<World> {
  const modules = ['core', 'contacts', 'pipelines', 'email'];

  const plan = await Plan.create({
    name: 'Test plan',
    modules,
    limits: { accounts: 10, users: 50, contacts: 100_000 },
  });

  const roles: Record<string, string> = {};
  for (const def of SYSTEM_ROLES) {
    const role = await Role.create({ ...def, isSystem: true, agencyId: null });
    roles[def.key] = String(role._id);
  }

  const agency = async (name: string, slug: string) =>
    String(
      (
        await Agency.create({
          name,
          slug,
          planId: String(plan._id),
          enabledModules: modules,
          moduleGrants: [],
          moduleDenies: [],
        })
      )._id,
    );

  const account = async (agencyId: string, name: string, slug: string) =>
    String(
      (
        await Account.create({
          agencyId,
          name,
          slug,
          enabledModules: modules,
          moduleGrants: [],
          moduleDenies: [],
        })
      )._id,
    );

  const A = await agency('Agency A', 'agency-a');
  const B = await agency('Agency B', 'agency-b');
  const A1 = await account(A, 'Account A1', 'a1');
  const A2 = await account(A, 'Account A2', 'a2');
  const B1 = await account(B, 'Account B1', 'b1');

  // One hash for everyone: bcrypt at cost 12 is slow on purpose, and seven of them would
  // dominate every test file's start-up.
  const passwordHash = await hashPassword(PASSWORD);

  const users = {} as World['users'];

  const user = async (
    key: UserKey,
    roleKey: string,
    agencyId: string,
    accountId?: string,
  ) => {
    const doc = await User.create({
      email: `${key.toLowerCase()}@example.com`,
      passwordHash,
      firstName: key,
      lastName: 'Test',
      status: 'active',
    });
    await Membership.create({
      userId: String(doc._id),
      scope: accountId ? 'account' : 'agency',
      agencyId,
      accountId,
      roleId: roles[roleKey],
      permissionOverrides: { grant: [], deny: [] },
      status: 'active',
    });
    users[key] = {
      id: String(doc._id),
      email: doc.email,
      token: signAccessToken({ sub: String(doc._id), email: doc.email }),
    };
  };

  await user('ownerA', 'agency_owner', A);
  await user('adminA1', 'account_admin', A, A1);
  await user('userA1', 'account_user', A, A1);
  await user('callerA1', 'caller', A, A1);
  await user('adminA2', 'account_admin', A, A2);
  await user('ownerB', 'agency_owner', B);
  await user('adminB1', 'account_admin', B, B1);

  return {
    planId: String(plan._id),
    agencies: { A, B },
    accounts: { A1, A2, B1 },
    roles,
    users,
  };
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

/**
 * A client that signs every request as one user, inside one sub-account.
 *
 * `accountId` becomes `X-Account-Id` — the header the API resolves permissions against,
 * which is deliberately separate from any id in the URL so tests can make the two disagree.
 */
export function as(user: { token: string }, accountId?: string) {
  const call = (method: Method) => (path: string) => {
    const req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${user.token}`);
    return accountId ? req.set('X-Account-Id', accountId) : req;
  };

  return {
    get: call('get'),
    post: call('post'),
    patch: call('patch'),
    put: call('put'),
    delete: call('delete'),
  };
}

/** An unauthenticated client, for the login and invite endpoints. */
export const anon = () => request(app);

/** Run model calls as if inside a request for one sub-account — for arranging test data. */
export function inAccount<T>(
  world: World,
  agency: keyof World['agencies'],
  account: keyof World['accounts'] | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx: TenantContext = {
    userId: 'test',
    agencyId: world.agencies[agency],
    accountId: account ? world.accounts[account] : undefined,
    scope: account ? 'account' : 'agency',
    permissions: ['*'],
    enabledModules: [],
  };
  // Awaited *inside* the context. A Mongoose query is a lazy thenable: handing one back
  // un-awaited would run it after the context had already been left, and it would throw.
  return runInTenantContext(ctx, async () => await fn());
}
