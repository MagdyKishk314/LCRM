import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { inAccount, startHarness, stopHarness, type World } from '../../test/harness';
import { Contact } from '../../models';

/**
 * The isolation boundary.
 *
 * MongoDB has no row-level security, so this plugin is the only thing standing between one
 * client's owner list and another's. Each test arranges data in three sub-accounts across
 * two agencies and then asks for it from the wrong place.
 */
let world: World;
const ids: Record<'A1' | 'A2' | 'B1', string[]> = { A1: [], A2: [], B1: [] };

const contact = (n: number) => ({ firstName: `First${n}`, lastName: `Last${n}`, tags: ['seed'] });

/** The plugin adds the tenant fields at runtime, so the inferred document type lacks them. */
const tenant = (doc: unknown) => doc as { _id: unknown; agencyId: string; accountId: string };

before(async () => {
  world = await startHarness();

  const make = async (agency: 'A' | 'B', account: 'A1' | 'A2' | 'B1', count: number) => {
    for (let i = 0; i < count; i++) {
      const doc = await inAccount(world, agency, account, () => Contact.create(contact(i)));
      ids[account].push(String(doc._id));
    }
  };

  await make('A', 'A1', 3);
  await make('A', 'A2', 2);
  await make('B', 'B1', 1);
});
after(stopHarness);

const inA1 = <T>(fn: () => Promise<T>) => inAccount(world, 'A', 'A1', fn);
const inAgencyA = <T>(fn: () => Promise<T>) => inAccount(world, 'A', undefined, fn);

test('a query with no tenant context throws rather than returning rows', async () => {
  await assert.rejects(Contact.find({}).exec(), /without a tenant context/);
  await assert.rejects(Contact.countDocuments({}).exec(), /without a tenant context/);
  await assert.rejects(Contact.create(contact(99)), /without a tenant context/);
  await assert.rejects(Contact.aggregate([{ $count: 'n' }]).exec(), /without a tenant context/);
  await assert.rejects(
    Contact.bulkWrite([{ updateOne: { filter: {}, update: { $set: { company: 'x' } } } }]),
    /without a tenant context/,
  );
});

test('find, count and distinct see only the active sub-account', async () => {
  await inA1(async () => {
    const found = await Contact.find({});
    assert.deepEqual(found.map((c) => String(c._id)).sort(), [...ids.A1].sort());
    assert.equal(await Contact.countDocuments({}), 3);
    assert.deepEqual(await Contact.distinct('accountId'), [world.accounts.A1]);
  });
});

test('an agency-scoped context spans its own sub-accounts and no other agency', async () => {
  await inAgencyA(async () => {
    assert.equal(await Contact.countDocuments({}), 5);
    assert.equal(await Contact.findById(ids.B1[0]), null);
  });
});

test("another tenant's document cannot be read by id", async () => {
  await inA1(async () => {
    assert.equal(await Contact.findById(ids.A2[0]), null);
    assert.equal(await Contact.findOne({ _id: ids.B1[0] }), null);
  });
});

test('writes by id do not reach across tenants', async () => {
  await inA1(async () => {
    const updated = await Contact.updateOne({ _id: ids.B1[0] }, { $set: { company: 'stolen' } });
    assert.equal(updated.matchedCount, 0);

    assert.equal(
      await Contact.findOneAndUpdate({ _id: ids.A2[0] }, { $set: { company: 'stolen' } }),
      null,
    );

    const deleted = await Contact.deleteOne({ _id: ids.B1[0] });
    assert.equal(deleted.deletedCount, 0);
  });

  const untouched = await Contact.find({ company: 'stolen' }).setOptions({
    bypassTenantScope: true,
  });
  assert.equal(untouched.length, 0);
});

test('an unfiltered updateMany stays inside the sub-account', async () => {
  await inA1(async () => {
    const result = await Contact.updateMany({}, { $set: { source: 'touched' } });
    assert.equal(result.modifiedCount, 3);
  });

  const touched = await Contact.find({ source: 'touched' }).setOptions({
    bypassTenantScope: true,
  });
  assert.deepEqual(touched.map((c) => String(c._id)).sort(), [...ids.A1].sort());
});

test('a created document is stamped with the tenant, whatever the caller supplies', async () => {
  const doc = tenant(
    await inA1(() =>
      Contact.create({
        ...contact(50),
        agencyId: world.agencies.B,
        accountId: world.accounts.B1,
      } as never),
    ),
  );
  assert.equal(doc.agencyId, world.agencies.A);
  assert.equal(doc.accountId, world.accounts.A1);
  await inA1(() => Contact.deleteOne({ _id: doc._id }));
});

test('insertMany stamps every document', async () => {
  const docs = (
    await inA1(() =>
      Contact.insertMany([
        { ...contact(60), accountId: world.accounts.B1 },
        { ...contact(61) },
      ] as never[]),
    )
  ).map(tenant);
  for (const doc of docs) {
    assert.equal(doc.agencyId, world.agencies.A);
    assert.equal(doc.accountId, world.accounts.A1);
  }
  await inA1(() => Contact.deleteMany({ _id: { $in: docs.map((d) => d._id) } }));
});

test('an account-scoped document cannot be created from an agency-scoped context', async () => {
  await assert.rejects(
    inAgencyA(() => Contact.create(contact(70))),
    /account-scoped document from an agency-scoped request/,
  );
});

test('bulkWrite filters and inserts are tenanted', async () => {
  await inA1(async () => {
    const result = await Contact.bulkWrite([
      { updateOne: { filter: { _id: ids.B1[0] }, update: { $set: { company: 'stolen' } } } },
      { updateOne: { filter: { _id: ids.A1[0] }, update: { $set: { company: 'mine' } } } },
      { insertOne: { document: { ...contact(80), accountId: world.accounts.B1 } } },
    ] as never[]);
    assert.equal(result.matchedCount, 1);
    assert.equal(result.insertedCount, 1);
  });

  const everything = await Contact.find({}).setOptions({ bypassTenantScope: true });
  assert.equal(everything.filter((c) => c.company === 'stolen').length, 0);

  const inserted = everything.find((c) => c.firstName === 'First80');
  assert.equal(tenant(inserted).accountId, world.accounts.A1);
  await inA1(() => Contact.deleteOne({ _id: inserted!._id }));
});

test('an aggregation is scoped before its first stage runs', async () => {
  const count = async () => {
    const rows: { n: number }[] = await Contact.aggregate([{ $count: 'n' }]);
    return rows[0]?.n ?? 0;
  };

  assert.equal(await inA1(count), 3);
  assert.equal(await inAgencyA(count), 5);
  assert.equal(await inAccount(world, 'B', 'B1', count), 1);

  // A `$group` with no `$match` of its own is the dangerous shape: appended rather than
  // prepended, the tenant filter would run after the totals had been summed across tenants.
  const grouped: { _id: string; n: number }[] = await inA1(() =>
    Contact.aggregate([{ $group: { _id: '$accountId', n: { $sum: 1 } } }]),
  );
  assert.deepEqual(grouped, [{ _id: world.accounts.A1, n: 3 }]);
});

test('bypassTenantScope is the only way to see across tenants', async () => {
  const all = await Contact.find({ tags: 'seed' }).setOptions({ bypassTenantScope: true });
  assert.equal(all.length, 6);
});

test('an unfiltered deleteMany removes only the active sub-account', async () => {
  await inAccount(world, 'A', 'A2', async () => {
    const result = await Contact.deleteMany({});
    assert.equal(result.deletedCount, 2);
  });

  const left = await Contact.find({ tags: 'seed' }).setOptions({ bypassTenantScope: true });
  assert.equal(left.length, 4);
});
