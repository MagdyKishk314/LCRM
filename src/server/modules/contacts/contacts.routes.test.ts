import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IMPORT_QUOTA_BYTES } from '@/shared';
import { as, inAccount, startHarness, stopHarness, type World } from '../../test/harness';
import { chargeImportQuota } from '../../core/quota';
import { Activity, AuditLog, Contact, Opportunity, Pipeline, UsageEvent } from '../../models';

let world: World;
let admin: ReturnType<typeof as>;

before(async () => {
  world = await startHarness();
  admin = as(world.users.adminA1, world.accounts.A1);
});
after(stopHarness);

const inA1 = <T>(fn: () => Promise<T>) => inAccount(world, 'A', 'A1', fn);

let n = 0;
async function createContact(body: Record<string, unknown> = {}) {
  n++;
  const res = await admin
    .post('/contacts')
    .send({ firstName: `Test${n}`, lastName: `Person${n}`, ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body as { id: string } & Record<string, any>;
}

const get = async (id: string) => (await admin.get(`/contacts/${id}`)).body;

// ── FIX-10 · partial updates ────────────────────────────────────────────────

test('editing one property field leaves the others alone', async () => {
  const contact = await createContact({
    property: { apn: '123-45-678', county: 'Costilla', state: 'CO', acres: 5 },
    address: { street: '1 Main St', city: 'Denver', state: 'CO' },
  });

  const res = await admin
    .patch(`/contacts/${contact.id}`)
    .send({ property: { acres: 12 }, address: { city: 'Pueblo' } });
  assert.equal(res.status, 200);

  const after = await get(contact.id);
  assert.deepEqual(
    [after.property.apn, after.property.county, after.property.state, after.property.acres],
    ['123-45-678', 'Costilla', 'CO', 12],
  );
  assert.deepEqual([after.address.street, after.address.city], ['1 Main St', 'Pueblo']);
});

test('setting one custom field keeps the rest, and values are checked against their definitions', async () => {
  // Definitions first: a value under a key nobody defined is refused, not stored.
  await admin.post('/contacts/fields').send({ label: 'Zoning', type: 'select', options: ['A-1', 'R-2'] });
  await admin.post('/contacts/fields').send({ label: 'Road access', type: 'checkbox' });
  await admin.post('/contacts/fields').send({ label: 'Offer amount', type: 'currency' });

  const contact = await createContact({ customFields: { zoning: 'A-1', road_access: true } });

  await admin.patch(`/contacts/${contact.id}`).send({ customFields: { zoning: 'R-2' } });
  const after = await get(contact.id);
  assert.deepEqual(after.customFields, { zoning: 'R-2', road_access: true });

  // The definitions come back beside the values.
  assert.ok(after.fieldDefinitions.some((d: { key: string }) => d.key === 'zoning'));

  const unknown = await admin.patch(`/contacts/${contact.id}`).send({ customFields: { nonsense: 'x' } });
  assert.equal(unknown.status, 400);

  const wrongOption = await admin.patch(`/contacts/${contact.id}`).send({ customFields: { zoning: 'C-9' } });
  assert.equal(wrongOption.status, 400);

  const coerced = await admin.patch(`/contacts/${contact.id}`).send({ customFields: { offer_amount: '$12,500' } });
  assert.equal(coerced.status, 200);
  assert.equal((await get(contact.id)).customFields.offer_amount, 12_500);
});

test('a custom field key that would write elsewhere is refused', async () => {
  const contact = await createContact();
  const res = await admin
    .patch(`/contacts/${contact.id}`)
    .send({ customFields: { 'a.b': 'x' } });
  assert.equal(res.status, 400);
});

// ── FIX-04 · do-not-contact ─────────────────────────────────────────────────

test('flag and status move together through every single-contact edit', async () => {
  const contact = await createContact();
  const patch = async (body: Record<string, unknown>) => {
    const res = await admin.patch(`/contacts/${contact.id}`).send(body);
    assert.equal(res.status, 200);
    return [res.body.dnc, res.body.status];
  };

  assert.deepEqual(await patch({ status: 'do_not_call' }), [true, 'do_not_call']);
  assert.deepEqual(await patch({ status: 'qualified' }), [false, 'qualified']);
  assert.deepEqual(await patch({ dnc: true }), [true, 'do_not_call']);
  assert.deepEqual(await patch({ company: 'Unrelated edit' }), [true, 'do_not_call']);
  assert.deepEqual(await patch({ dnc: false }), [false, 'contacted']);

  // Lifting the flag moved the status, and that is on the timeline.
  const { history } = await get(contact.id);
  const changes = history.data.filter((a: { type: string }) => a.type === 'status_change');
  assert.equal(changes[0].metadata.to, 'contacted');
});

test('creating with either signal sets both', async () => {
  assert.deepEqual(
    await createContact({ dnc: true }).then((c) => [c.dnc, c.status]),
    [true, 'do_not_call'],
  );
  assert.deepEqual(
    await createContact({ status: 'do_not_call' }).then((c) => [c.dnc, c.status]),
    [true, 'do_not_call'],
  );
});

test('bulk actions keep the pair in step', async () => {
  const a = await createContact({ status: 'qualified' });
  const b = await createContact({ status: 'do_not_call' });
  const ids = [a.id, b.id];
  const pairs = async () =>
    Promise.all(ids.map(async (id) => get(id).then((c) => [c.dnc, c.status])));

  await admin.post('/contacts/bulk').send({ action: 'dnc', value: 'false', ids });
  assert.deepEqual(await pairs(), [
    [false, 'qualified'],
    [false, 'contacted'],
  ]);

  await admin.post('/contacts/bulk').send({ action: 'dnc', ids });
  assert.deepEqual(await pairs(), [
    [true, 'do_not_call'],
    [true, 'do_not_call'],
  ]);

  await admin.post('/contacts/bulk').send({ action: 'status', value: 'new', ids });
  assert.deepEqual(await pairs(), [
    [false, 'new'],
    [false, 'new'],
  ]);

  await admin.post('/contacts/bulk').send({ action: 'status', value: 'do_not_call', ids });
  assert.deepEqual(await pairs(), [
    [true, 'do_not_call'],
    [true, 'do_not_call'],
  ]);
});

// ── FIX-15 · search ─────────────────────────────────────────────────────────

test('search finds a contact by name, phone and APN, in the forms people type', async () => {
  const contact = await createContact({
    firstName: 'Marlene',
    lastName: 'Whitfield',
    phone: '(719) 555-0142',
    email: 'marlene@example.com',
    property: { apn: '987-65-432' },
  });

  const found = async (search: string) => {
    const res = await admin.get('/contacts').query({ search });
    assert.equal(res.status, 200);
    return res.body.data.some((c: { id: string }) => c.id === contact.id);
  };

  for (const term of [
    'marl',
    'WHITFIELD',
    'marlene whitfield',
    'whitfield marlene',
    '7195550142',
    '(719) 555-0142',
    '555-0142',
    '0142',
    '987-65-432',
    '98765432',
    'marlene@example',
  ]) {
    assert.ok(await found(term), `"${term}" should find her`);
  }

  assert.ok(!(await found('marlene kowalski')), 'every word must match');
  assert.ok(!(await found('hitfield')), 'mid-word fragments do not match');
});

test('search follows an edit', async () => {
  const contact = await createContact({ firstName: 'Odell', lastName: 'Abernathy' });
  await admin.patch(`/contacts/${contact.id}`).send({ lastName: 'Lindqvist' });

  const by = async (search: string) =>
    (await admin.get('/contacts').query({ search })).body.data.map((c: { id: string }) => c.id);

  assert.ok((await by('lindq')).includes(contact.id));
  assert.ok(!(await by('abernathy')).includes(contact.id));
});

test('global search uses the same matching', async () => {
  const contact = await createContact({ firstName: 'Bernice', lastName: 'Okafor' });
  const res = await admin.get('/core/search').query({ q: 'bernice oka' });
  assert.ok(res.body.contacts.some((c: { id: string }) => c.id === contact.id));
});

test('the search index is used, not a scan', async () => {
  const plan = await inA1(() =>
    Contact.find({ $and: [{ searchTokens: /^marl/ }] }).explain('queryPlanner'),
  );
  const text = JSON.stringify(plan);
  assert.match(text, /IXSCAN/);
  assert.match(text, /searchTokens/);
  assert.doesNotMatch(text, /COLLSCAN/);
});

// ── FIX-11 · lists ──────────────────────────────────────────────────────────

const lists = async () =>
  (await admin.get('/contacts/lists/all')).body.data as {
    id: string;
    memberCount: number;
    memberIds?: unknown;
  }[];

test('static list membership lives on the contact and is counted live', async () => {
  const [a, b, c] = await Promise.all([createContact(), createContact(), createContact()]);

  const created = await admin.post('/contacts/lists').send({ name: 'Callbacks', memberIds: [a!.id] });
  assert.equal(created.status, 201);
  assert.equal(created.body.memberCount, 1);
  const listId = created.body.id as string;

  const added = await admin
    .post('/contacts/bulk')
    .send({ action: 'addToList', value: listId, ids: [a!.id, b!.id] });
  assert.equal(added.body.affected, 2);

  const members = await admin.get('/contacts').query({ listId });
  assert.deepEqual(
    members.body.data.map((m: { id: string }) => m.id).sort(),
    [a!.id, b!.id].sort(),
  );
  assert.ok(!members.body.data.some((m: { id: string }) => m.id === c!.id));

  const stored = (await lists()).find((l) => l.id === listId)!;
  assert.equal(stored.memberCount, 2);
  assert.equal(stored.memberIds, undefined, 'the list no longer carries its members');

  // Deleting a member is reflected without anything having to update the list.
  await admin.delete(`/contacts/${a!.id}`);
  assert.equal((await lists()).find((l) => l.id === listId)!.memberCount, 1);

  // Deleting the list leaves the contact, and leaves it clean.
  assert.equal((await admin.delete(`/contacts/lists/${listId}`)).status, 204);
  assert.deepEqual((await get(b!.id)).listIds, []);
});

test('a smart list intersects with the rest of the filter', async () => {
  const tx = await createContact({ status: 'qualified', property: { state: 'TX' } });
  const co = await createContact({ status: 'qualified', property: { state: 'CO' } });
  const cold = await createContact({ status: 'new', property: { state: 'TX' } });

  const list = await admin
    .post('/contacts/lists')
    .send({ name: 'Hot', type: 'smart', filter: { status: ['qualified'] } });
  const listId = list.body.id as string;

  const ids = async (query: Record<string, string>) =>
    (await admin.get('/contacts').query({ listId, pageSize: '200', ...query })).body.data.map(
      (c: { id: string }) => c.id,
    );

  const all = await ids({});
  assert.ok(all.includes(tx.id) && all.includes(co.id) && !all.includes(cold.id));

  // The user's own filter narrows the list rather than being overwritten by it.
  const texas = await ids({ state: 'TX' });
  assert.ok(texas.includes(tx.id));
  assert.ok(!texas.includes(co.id), 'state filter must still apply inside a smart list');

  // The user's status filter cannot widen the list either.
  const widened = await ids({ status: 'new' });
  assert.ok(!widened.includes(cold.id));
});

// ── FIX-09 · deleting contacts ──────────────────────────────────────────────

async function withHistory() {
  const contact = await createContact();

  await admin.post(`/contacts/${contact.id}/activities`).send({ title: 'Left a voicemail' });
  await inA1(async () => {
    const pipeline =
      (await Pipeline.findOne({})) ??
      (await Pipeline.create({
        name: 'Acquisition',
        isDefault: true,
        stages: [{ id: 's1', name: 'Lead', order: 0 }],
      }));
    await Opportunity.create({
      pipelineId: String(pipeline._id),
      stageId: 's1',
      contactId: contact.id,
      name: 'Deal',
    });
  });

  return contact.id;
}

const remnants = (ids: string[]) =>
  inA1(async () => ({
    contacts: await Contact.countDocuments({ _id: { $in: ids } }),
    activities: await Activity.countDocuments({ contactId: { $in: ids } }),
    opportunities: await Opportunity.countDocuments({ contactId: { $in: ids } }),
  }));

test('deleting a contact takes its timeline and opportunities with it', async () => {
  const id = await withHistory();
  const before = await remnants([id]);
  assert.ok(before.activities >= 2 && before.opportunities === 1);

  assert.equal((await admin.delete(`/contacts/${id}`)).status, 204);
  assert.deepEqual(await remnants([id]), { contacts: 0, activities: 0, opportunities: 0 });

  assert.equal((await admin.delete(`/contacts/${id}`)).status, 404);
});

test('bulk delete cascades and records what went', async () => {
  const ids = [await withHistory(), await withHistory()];

  const res = await admin.post('/contacts/bulk').send({ action: 'delete', ids });
  assert.equal(res.status, 200);
  assert.equal(res.body.affected, 2);
  assert.equal(res.body.opportunities, 2);

  assert.deepEqual(await remnants(ids), { contacts: 0, activities: 0, opportunities: 0 });

  const audit = await AuditLog.findOne({ action: 'contacts.bulk.delete' }).sort({ createdAt: -1 });
  assert.equal(audit?.before.count, 2);
  assert.equal(audit?.before.opportunities, 2);
});

test("a delete cannot reach another sub-account's contacts", async () => {
  const theirs = await inAccount(world, 'A', 'A2', () =>
    Contact.create({ firstName: 'Not', lastName: 'Yours' }),
  );

  assert.equal((await admin.delete(`/contacts/${theirs._id}`)).status, 404);

  const bulk = await admin
    .post('/contacts/bulk')
    .send({ action: 'delete', ids: [String(theirs._id)] });
  assert.equal(bulk.body.affected, 0);

  const still = await inAccount(world, 'A', 'A2', () => Contact.findById(theirs._id));
  assert.ok(still);
});

// ── Import: re-running a file must add to a record, never take away ─────────

const COLUMNS = ['First', 'Last', 'Phone', 'Status', 'Tags', 'City', 'Street', 'Id'];
const MAPPING = {
  First: 'firstName',
  Last: 'lastName',
  Phone: 'phone',
  Status: 'status',
  Tags: 'tags',
  City: 'address.city',
  Street: 'address.street',
  Id: 'externalId',
};

/** Open a job, send the rows as one chunk, finish the job — what the wizard does. */
const importRows = async (
  rows: string[][],
  extra: { listId?: string; strategy?: 'update' | 'skip' | 'create'; tag?: string; ownerId?: string; mapping?: Record<string, string>; columns?: string[] } = {},
) => {
  const { mapping = MAPPING, columns = COLUMNS, ...jobFields } = extra;
  const job = await admin.post('/contacts/import/jobs').send({
    fileName: 'test.csv',
    mapping,
    totalRows: rows.length,
    ...jobFields,
  });
  assert.equal(job.status, 201, JSON.stringify(job.body));

  const res = await admin
    .post('/contacts/import/commit')
    .send({ columns, rows, mapping, jobId: job.body.id });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  await admin.post(`/contacts/import/jobs/${job.body.id}/finish`).send({ status: 'finished' });
  return { ...(res.body as { created: number; updated: number; skipped: number }), jobId: job.body.id as string };
};

const bySourceId = (sourceId: string) =>
  inA1(() => Contact.findOne({ sourceId }).select('+searchTokens').lean());

test('a re-import never lifts do-not-contact, and merges rather than replaces', async () => {
  const list = await admin.post('/contacts/lists').send({ name: 'Imported' });
  const listId = list.body.id as string;

  const first = await importRows(
    [['Hector', 'Bautista', '(303) 555-0101', 'Do Not Call', 'litigator', 'Denver', '9 Elm St', 'ext-1']],
    { listId },
  );
  assert.deepEqual([first.created, first.updated], [1, 0]);

  const initial = await bySourceId('ext-1');
  assert.deepEqual([initial?.dnc, initial?.status], [true, 'do_not_call']);
  assert.deepEqual(initial?.listIds, [listId]);

  // A refresh that carries a plain status, a new tag, a new city and no street.
  const second = await importRows([
    ['Hector', 'Bautista', '(303) 555-0101', 'New', 'refresh-2026', 'Pueblo', '', 'ext-1'],
  ]);
  assert.deepEqual([second.created, second.updated], [0, 1]);

  const after = await bySourceId('ext-1');
  assert.deepEqual([after?.dnc, after?.status], [true, 'do_not_call'], 'still do-not-contact');
  assert.deepEqual([...(after?.tags ?? [])].sort(), ['litigator', 'refresh-2026']);
  assert.equal(after?.address?.city, 'Pueblo');
  assert.equal(after?.address?.street, '9 Elm St', 'a blank cell must not erase the street');
  assert.deepEqual(after?.listIds, [listId], 'list membership survives a re-import');
});

test('an import can flag do-not-contact, and updates a status that is not flagged', async () => {
  await importRows([['Ruth', 'Nakamura', '(303) 555-0102', 'Contacted', '', '', '', 'ext-2']]);
  assert.equal((await bySourceId('ext-2'))?.status, 'contacted');

  // A file with no status for her leaves what is there.
  await importRows([['Ruth', 'Nakamura', '(303) 555-0102', '', '', '', '', 'ext-2']]);
  assert.equal((await bySourceId('ext-2'))?.status, 'contacted');

  await importRows([['Ruth', 'Nakamura', '(303) 555-0102', 'Qualified', '', '', '', 'ext-2']]);
  assert.equal((await bySourceId('ext-2'))?.status, 'qualified');

  await importRows([['Ruth', 'Nakamura', '(303) 555-0102', 'DNC', '', '', '', 'ext-2']]);
  assert.equal((await bySourceId('ext-2'))?.status, 'qualified', '"DNC" is not a known status');

  await importRows([['Ruth', 'Nakamura', '(303) 555-0102', 'do not call', '', '', '', 'ext-2']]);
  const flagged = await bySourceId('ext-2');
  assert.deepEqual([flagged?.dnc, flagged?.status], [true, 'do_not_call']);
});

test('two rows for one person in a file do not undo each other', async () => {
  await importRows([
    ['Stan', 'Ortega', '(303) 555-0103', 'do_not_call', 'a', 'Denver', '4 Oak Ave', 'ext-3'],
    ['Stan', 'Ortega', '(303) 555-0103', '', 'b', '', '', 'ext-3'],
  ]);

  const merged = await bySourceId('ext-3');
  assert.deepEqual([merged?.dnc, merged?.status], [true, 'do_not_call']);
  assert.deepEqual([...(merged?.tags ?? [])].sort(), ['a', 'b']);
  assert.equal(merged?.address?.street, '4 Oak Ave');
});

test('imported contacts are searchable, and stay so when a re-import changes them', async () => {
  await importRows([['Doris', 'Lindqvist', '(303) 555-0104', '', '', '', '', 'ext-4']]);

  const found = async (search: string) =>
    (await admin.get('/contacts').query({ search })).body.data.some(
      (c: { sourceId?: string }) => c.sourceId === 'ext-4',
    );

  assert.ok(await found('doris lind'));
  assert.ok(await found('3035550104'));

  await importRows([['Doris', 'Lindqvist', '(303) 555-0999', '', '', '', '', 'ext-4']]);
  assert.ok(await found('3035550999'), 'findable by the new number');
  assert.ok(!(await found('3035550104')), 'and no longer by the old one');
});

// ── FIX-13 · the quota under concurrency ────────────────────────────────────

test('two uploads racing for the last of the quota cannot both get in', async () => {
  const MB = 1024 * 1024;
  const ctx = { agencyId: world.agencies.A, accountId: world.accounts.A2 };

  const total = () =>
    inAccount(world, 'A', 'A2', async () =>
      (await UsageEvent.find({ kind: 'import' })).reduce((sum, e) => sum + e.bytes, 0),
    );

  // One megabyte of headroom left.
  await inAccount(world, 'A', 'A2', () =>
    UsageEvent.create({ kind: 'import', bytes: IMPORT_QUOTA_BYTES - MB, contentHash: 'seed' }),
  );

  // Two distinct payloads of just over half a megabyte: either fits, both do not.
  const payload = (fill: string) => fill.repeat(0.6 * MB);
  const results = await Promise.all(
    ['a', 'b'].map((fill) =>
      inAccount(world, 'A', 'A2', () => chargeImportQuota(ctx, payload(fill))),
    ),
  );

  assert.ok(results.filter((r) => r.ok).length <= 1, 'at most one may be accepted');
  assert.ok((await total()) <= IMPORT_QUOTA_BYTES, 'the recorded total stays within the limit');

  for (const refused of results.filter((r) => !r.ok)) {
    assert.ok(refused.retryAt instanceof Date, 'a refusal says when to come back');
  }
});
